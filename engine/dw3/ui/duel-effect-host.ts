// The hosts the duel's effect layer runs against.
//
// The effect-VM opcode runner (F0x80084320, effect-vm.ts) reaches 96 helper
// routines; the effect-step machines (F0x800A2180 / F0x800A2608,
// duel-effect-step.ts) reach a dozen view methods and the shared input port. A
// handful already have engine ports (the phase banner, the view window, the
// counter service, the dynamic-stat megas); every other edge is a NAMED GAP:
// calling it throws a TranslatedGapError naming the original routine, so the
// session can never fetch an instruction or substitute a silent success.
//
// This module builds both hosts from a `gap` callback and the session's already
// ported services, so the tick can run the effect VM for real and the whole-
// match verifier names the exact helper that still blocks it.

import type { EffectVmHost } from "./effect-vm.ts";
import type { DuelEffectStepHost } from "./duel-effect-step.ts";

/** A named gap: the original routine at `addr` is not translated yet. */
export type EffectGap = (addr: number, role: string) => never;

/** The edges the session already runs for real. */
export interface DuelEffectHostServices {
    /** F0x800A09FC(duel): run every colour's mega across both rows (duel-counter-service.ts). */
    applyDynamicStatMegas(duel: number): number;
    /** F0x800A1DB8(duel, scene): ask the board view to open (duel-view-window.ts). */
    waitViewWindowOpen(duel: number, scene: number): number;
    /** F0x800A1E60(duel, scene): the resolving card's presentation (duel-view-window.ts). */
    presentResolvingCard(duel: number, scene: number): number;
    /** F0x8009EDCC(duel, scene): repaint both HUD strips (duel-counter-service.ts). */
    repaintHudStrips(duel: number, scene: number): void;
    /** F0x800894E4(duel, view, banner): raise a phase banner (phase-banner.ts). */
    showPhaseBanner(duel: number, view: number, banner: number): void;
    /** F0x80089580(duel, view): the phase banner's step machine (phase-banner.ts). */
    tickPhaseBanner(duel: number, view: number): number;
    /** `view+0xEE4` = F0x8009C054: wipe prompt window A open (view-openers.ts). */
    openPromptView(view: number, a1: number, a2: number, a3: number, a4: number): void;
    /** `view+0xEE8` = F0x8009C0DC: close prompt window A (view-openers.ts). */
    closePromptView(view: number): void;
    /** `view+0xEEC` = F0x8009C124: confirm/dismiss prompt window A (view-openers.ts). */
    confirmPromptView(view: number): void;
    /** pad block +0x3F4 = F0x80018854(port): the shared input port's pressed word. */
    inputPressed(port: number): number;
    /** pad block +0x408 = F0x80018980(port, code): the logical button's bit index. */
    inputButtonBit(port: number, code: number): number;
    /** pad block +0x3FC = F0x8001889C(port): the shared input port's repeat word. */
    inputRepeat(port: number): number;
}

/** [EffectVmHost method name, original routine address]. */
const EFFECT_VM_GAPS: ReadonlyArray<readonly [keyof EffectVmHost, number]> = [
    ["cardRecordCursorCreate", 0x8001ebf8],
    ["cardRecordSelect", 0x8001e7ec],
    ["cardRecordPointer", 0x8001e7ec],
    ["branchIfActingSide", 0x80083f48],
    ["branchIfHandAtMost", 0x80083f84],
    ["branchIfHandOver", 0x80083fc8],
    ["effectOp0eBranchIfFolderNonempty", 0x8008400c],
    ["effectOp10BranchIfFieldUnderSix", 0x8008404c],
    ["pollEffectTimer", 0x80084090],
    ["effectOp4bPickSelectionBySide", 0x800840d0],
    ["markSlotsMatchingEffectAttr", 0x800840f0],
    ["aiPickBestOppFieldSlot", 0x80084188],
    ["playSEnergyFlourish", 0x8008423c],
    ["tickYesNoConfirm", 0x8008642c],
    ["openLegalRowPicker", 0x80086d78],
    ["openBrowsePicker", 0x80086eb0],
    ["tickCardPicker", 0x80087edc],
    ["effectOp9eOpenScoreScreen", 0x80088f0c],
    ["tickScoreScreen", 0x80088f78],
    ["effectOpA8EnterTwoHandCompare", 0x80089ec8],
    ["tickTwoHandCompare", 0x8008a068],
    ["enterTwoHandCompareMode", 0x8008ad48],
    ["tickTwoHandComparePick", 0x8008ad98],
    ["openPilePicker", 0x8008baa4],
    ["openPilePickerKind0", 0x8008bc6c],
    ["tickPilePicker", 0x8008c044],
    ["effectOp9dAutoPickLegalSummons", 0x8008c5f0],
    ["aiHandPick", 0x8008c6e0],
    ["aiPickFirstLegalPileCard", 0x8008c8d8],
    ["aiPickLowestStatPileCard", 0x8008c988],
    ["openChoosePilePrompt", 0x8008ca4c],
    ["tickChoosePilePrompt", 0x8008cb5c],
    ["openRespondPrompt", 0x8008ce0c],
    ["tickRespondPrompt", 0x8008cfdc],
    ["markFieldByFilter", 0x8008d274],
    ["tickMultiSlotHighlight", 0x8008d594],
    ["playMarkedSlotFx", 0x8008ddc0],
    ["waitFrames", 0x8008deac],
    ["queueStatChange", 0x8008def8],
    ["statRampTick", 0x8008e08c],
    ["markEffectFieldTargets", 0x8008e398],
    ["effectOp4cEnterHandShuffle", 0x8008e5b0],
    ["tickHandShuffle", 0x8008e5bc],
    ["markZoneByMask", 0x8008ec44],
    ["markFieldByMask", 0x8008eec8],
    ["effectOp49EnterSweepBoardToDiscard", 0x8008f0b4],
    ["tickSweepBoardToDiscard", 0x8008f0f4],
    ["enterSEnergyDelta", 0x8008f2d8],
    ["effectOp29EnterZeroAllEnergy", 0x8008f530],
    ["tickZeroAllEnergy", 0x8008f560],
    ["effectOp41EnterReturnResolvingCard", 0x8008f750],
    ["tickReturnResolvingCard", 0x8008f790],
    ["effectOp2aRequestCardCutIn", 0x8008f948],
    ["openZoomedCard", 0x8008f978],
    ["tickZoomedCardToDiscard", 0x8008fa9c],
    ["drawPileCardToBoard", 0x8008ff08],
    ["tickPlayCardSequence", 0x80090058],
    ["effectOp44EnterShuffleDiscardToDeck", 0x8009076c],
    ["tickShuffleDiscardToDeck", 0x800907ac],
    ["clearMarksSetQuota", 0x80090a6c],
    ["markTopNOfPile", 0x80090a90],
    ["effectOp48MoveMarkedToBoard", 0x80090ba0],
    ["tickMoveMarkedToBoard", 0x80090cd8],
    ["enterDiscardMarked", 0x800915c4],
    ["tickDiscardMarked", 0x800915d4],
    ["placeCardOnField", 0x80091858],
    ["effectOp56ReturnCardToHand", 0x800919fc],
    ["tickCardLand3", 0x80091c6c],
    ["effectOp57CopyMarkedCardToSlot", 0x80091eb0],
    ["tickCardLand5", 0x80092198],
    ["openResolveWindow", 0x80092438],
    ["tickResolveSequence", 0x80092638],
    ["enterDamageTransfer", 0x80093624],
    ["tickAttackDrain", 0x80093710],
    ["enterClearPlayedRow", 0x80093adc],
    ["tickClearPlayedRow", 0x80093b10],
    ["effectOp1bOpenComboCard", 0x80093c18],
    ["tickComboCard", 0x80093cac],
    ["buildFusion", 0x8009403c],
    ["tickFusion", 0x800942dc],
    ["effectOp5aResetStatAccums", 0x80094828],
    ["tickRecountTotals", 0x80094848],
    ["resetRoundEndAccums", 0x80094b78],
    ["tickRoundEnd", 0x80094b9c],
    ["showBanner", 0x80094fdc],
    ["tickBannerWait", 0x80095030],
    ["popPlayedStack", 0x8009518c],
    ["pushPlayedStack", 0x80095208],
    ["popPlayedStackWithWindow", 0x80095274],
    ["pushPlayedStackWaitWindow", 0x800952f4],
    ["effectOp5dTickStatSettle", 0x8009535c],
];

/** The effect-VM host: the phase banner and the ported helpers run real; every
 *  other edge is a gap. `ported` supplies a real body for an edge that has left
 *  EFFECT_VM_GAPS (engine/dw3/ui/duel-effect-ops.ts). */
export function createEffectVmHost(
    gap: EffectGap, svc: DuelEffectHostServices, ported: Partial<EffectVmHost> = {},
): EffectVmHost {
    const host: Record<string, unknown> = {};
    for (const [name, addr] of EFFECT_VM_GAPS) {
        host[name] = () => gap(addr, `effect opcode helper ${name}`);
    }
    host.showPhaseBanner = (duel: number, view: number, banner: number) => svc.showPhaseBanner(duel, view, banner);
    host.tickPhaseBanner = (duel: number, view: number) => svc.tickPhaseBanner(duel, view);
    Object.assign(host, ported);
    return host as unknown as EffectVmHost;
}

/** The effect-step host's own unported edges (view methods + the input port). */
export const EFFECT_STEP_HOST_GAP_COUNT = 7;
/** How many effect-layer edges are still named gaps. */
export const EFFECT_LAYER_GAP_COUNT = EFFECT_VM_GAPS.length + EFFECT_STEP_HOST_GAP_COUNT;

/**
 * The effect-step host: the card probe, the view window and the HUD repaint run
 * real; the card-record predicate, the resolving-card stat change and the board
 * view's own menu methods are gaps.
 */
export function createEffectStepHost(gap: EffectGap, svc: DuelEffectHostServices): DuelEffectStepHost {
    return {
        resolvingCardProbe: (duel) => svc.applyDynamicStatMegas(duel),
        waitViewWindowOpen: (duel, scene) => svc.waitViewWindowOpen(duel, scene),
        presentResolvingCard: (duel, scene) => svc.presentResolvingCard(duel, scene),
        cardPredicate: () => gap(0x80083e34, "effect step card predicate"),
        checkResolvingLegality: () => gap(0x800954f8, "effect step resolution legality gate (checkEffectLegality)"),
        viewOpenPrompt: (view, a1, a2, a3, a4) => svc.openPromptView(view, a1, a2, a3, a4),
        viewRedrawField: (view) => svc.closePromptView(view),
        repaintHudStrips: (duel, scene) => svc.repaintHudStrips(duel, scene),
        inputPortReset: (a0) => svc.inputPressed(a0),
        inputPortWord: (a0, code) => svc.inputButtonBit(a0, code),
        inputPortState: (a0) => svc.inputRepeat(a0),
        playSound: () => gap(0x80055c48, "packed sound service ([0x80055C48])"),
        viewOpEec: (view) => svc.confirmPromptView(view),
        viewOpEf4: () => gap(0x8000ef4, "board view row cursor (view+0xEF4)"),
        viewOpEf8: () => gap(0x8000ef8, "board view confirm (view+0xEF8)"),
        viewOpEfc: () => gap(0x8000efc, "board view cancel (view+0xEFC)"),
        viewOpF00: () => gap(0x8000f00, "board view row highlight (view+0xF00)"),
    };
}
