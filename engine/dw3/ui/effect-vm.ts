// F0x80084320 — the card-duel effect interpreter, the machine that runs one
// queued Program-card step per frame.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/effect-vm-oracle.test.js runs the original through engine/native
// on the shipped pro_cardgame.bin with every one of its 96 helper calls stubbed,
// for every enter opcode (1..0xAE) and every update opcode (0..0xAE), and
// compares the ordered call log and the whole duel object.
//
// Authority 2 (original assembly):
//   exe-decomp/cardgame_c/_asm/F0x80084320.s   (the listing, line by line)
//   exe-decomp/cardgame_c/F0x80084320.c        (m2c, cross-checked per arm)
// Helper names and roles: docs/research/ui/symbols/cardgame.json.
// Opcode meanings: docs/research/card/card-effect-programs-2026-08-22.md.
//
// WHAT IT IS. A Program card's behaviour is a byte string; duel+0x4E0 is the
// program counter, duel+0x4E4 the loop mark, duel+0x4E2 the repeat count,
// duel+0x2F4 the "what should the duel tick do next" byte. One call consumes at
// most one opcode, in two phases:
//
//   fetch   v = u8(duel+0x421). If v != 0 the pending opcode runs its ENTER arm
//           (a jump through the 174-word table at 0x80082CF8, indexed v-1);
//           then the latch copies u8(duel+0x421) to u8(duel+0x420) and clears
//           0x421, and the UPDATE arm for u8(duel+0x420) runs (the 175-word
//           table at 0x80082FB0, indexed by the byte itself).
//
//   v == 0 means "nothing pending": 0x421 is NOT re-read and 0x420 keeps the
//   opcode latched last time, so the update arm for it runs again. That is the
//   two-phase shape: the enter arm starts the animation, the update arm polls
//   it until it reports finished and then writes duel+0x2F4 (0 = done/yield,
//   2 = done, 3 = hand over to the tick's arm 3).
//
// ENTER and UPDATE arms share this function's frame, so "arm" here means a jump
// target inside the one function, not a function: the coverage report lists the
// four that the capture actually reached (0x80084AF8, 0x80084EBC, 0x80085B74,
// 0x80085DC8) as separate rows, and all four are implemented here.
//
// One arm does something the port cannot do by itself, and it is an explicit
// host boundary rather than a silent simplification: opcode 0x0F builds a
// card-record cursor on its own stack frame (F0x8001EBF8), selects a record
// through the cursor's +0x2C method (F0x8001E7EC) and reads the colour byte at
// the record pointer the cursor exposes at +0x00. See cardRecordCursorCreate.

// The two shipped dispatch tables are embedded pointer data (effect-vm-tables.ts)
// rather than read from a live overlay, so a data-only session can run this the
// same way the Draw Phase runs its 22-arm table.
import { EFFECT_ENTER_WORDS, EFFECT_UPDATE_WORDS } from "./effect-vm-tables.ts";

export interface EffectVmMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface EffectVmHost {
    /** F0x8001EBF8(obj): build the card-record cursor the 0x0F arm keeps on its frame. Returns its handle. */
    cardRecordCursorCreate(): number;
    /** The cursor's +0x2C method (F0x8001E7EC): select record `n` (0 = the first). */
    cardRecordSelect(cursor: number, n: number): void;
    /** `[cursor+0x00]`: the record the cursor currently points at. */
    cardRecordPointer(cursor: number): number;

    /** F0x80083F48(duel, view, side, delta): jump `delta` when the last play was that side's. */
    branchIfActingSide(duel: number, view: number, side: number, delta: number): void;
    /** F0x80083F84(duel, side, atMost, delta). */
    branchIfHandAtMost(duel: number, side: number, atMost: number, delta: number): void;
    /** F0x80083FC8(duel, side, over, delta). */
    branchIfHandOver(duel: number, side: number, over: number, delta: number): void;
    /** F0x8008400C(duel, side, delta): jump when that side's folder still holds cards. */
    effectOp0eBranchIfFolderNonempty(duel: number, side: number, delta: number): void;
    /** F0x8008404C(duel, side, delta): jump when that side's board holds fewer than six. */
    effectOp10BranchIfFieldUnderSix(duel: number, side: number, delta: number): void;
    /** F0x80084090(duel, view): the current effect's countdown; nonzero when finished. */
    pollEffectTimer(duel: number, view: number): number;
    /** F0x800840D0(duel, view, side): the per-side stored selection index. */
    effectOp4bPickSelectionBySide(duel: number, view: number, side: number): void;
    /** F0x800840F0(duel, view): mark the slots whose attribute matches the resolving card. */
    markSlotsMatchingEffectAttr(duel: number, view: number): void;
    /** F0x80084188(duel): the opponent AI's pick of a far-side board slot. */
    aiPickBestOppFieldSlot(duel: number): void;
    /** F0x8008423C(duel, view): the S-Energy flourish; nonzero when it is over. */
    playSEnergyFlourish(duel: number, view: number): number;
    /** F0x80086330(duel, view, mode): open your own board picker. */
    effectOp98OpenOwnFieldPicker(duel: number, view: number, mode: number): void;
    /** F0x8008642C(duel, view): the yes/no box; 1 yes, 2 no, 0 still open. */
    tickYesNoConfirm(duel: number, view: number): number;
    /** F0x80086D78(duel, view, rows): open a picker that tests each row up front. */
    openLegalRowPicker(duel: number, view: number, rows: number): void;
    /** F0x80086EB0(duel, view, count, kind): open a browse-only picker. */
    openBrowsePicker(duel: number, view: number, count: number, kind: number): void;
    /** F0x80087EDC(duel, view, rows): the card picker; -1 while it is still open. */
    tickCardPicker(duel: number, view: number, rows: number): number;
    /** F0x80088F0C(duel, view): open the end-of-duel score screen. */
    effectOp9eOpenScoreScreen(duel: number, view: number): void;
    /** F0x80088F78(duel, view): the score screen; nonzero when it is finished. */
    tickScoreScreen(duel: number, view: number): number;
    /** F0x800894E4(duel, view, banner): show one phase banner. */
    showPhaseBanner(duel: number, view: number, banner: number): void;
    /** F0x80089580(duel, view): the phase banner; nonzero once answered. */
    tickPhaseBanner(duel: number, view: number): number;
    /** F0x8008985C(duel, view): start the coin toss. */
    effectOpA7StartCoinToss(duel: number, view: number): void;
    /** F0x80089974(duel, view): the coin toss; nonzero when it is finished. */
    tickCoinToss(duel: number, view: number): number;
    /** F0x80089EC8(duel, view): start the two-hand comparison. */
    effectOpA8EnterTwoHandCompare(duel: number, view: number): void;
    /** F0x8008A068(duel, view): the two-hand comparison; nonzero when finished. */
    tickTwoHandCompare(duel: number, view: number): number;
    /** F0x8008AD48(duel, view, mode): the second two-hand comparison. */
    enterTwoHandCompareMode(duel: number, view: number, mode: number): void;
    /** F0x8008AD98(duel, view): the comparison pick; 1 cancel, 2 picked, 0 open. */
    tickTwoHandComparePick(duel: number, view: number): number;
    /** F0x8008BAA4(duel, view, side, kind): open the pile picker. */
    openPilePicker(duel: number, view: number, side: number, kind: number): void;
    /** F0x8008BC6C(duel, view, side): the pile picker locked to kind 0. */
    openPilePickerKind0(duel: number, view: number, side: number): void;
    /** F0x8008C044(duel, view, mode): the pile picker; 1 cancel, 2 picked, 0 open. */
    tickPilePicker(duel: number, view: number, mode: number): number;
    /** F0x8008C5F0(duel, view): auto-pick legal summons; nonzero when finished. */
    effectOp9dAutoPickLegalSummons(duel: number, view: number): number;
    /** F0x8008C6E0(duel, view, kind): the AI's hand pick. */
    aiHandPick(duel: number, view: number, kind: number): void;
    /** F0x8008C8D8(duel, view): the AI takes the first legal marked pile card. */
    aiPickFirstLegalPileCard(duel: number, view: number): void;
    /** F0x8008C988(duel, view): the AI takes the lowest-stat marked pile card. */
    aiPickLowestStatPileCard(duel: number, view: number): void;
    /** F0x8008CA4C(duel, view, mask): open the choose-a-pile prompt. */
    openChoosePilePrompt(duel: number, view: number, mask: number): void;
    /** F0x8008CB5C(duel, view): the choose-a-pile prompt; -1 while it is open. */
    tickChoosePilePrompt(duel: number, view: number): number;
    /** F0x8008CE0C(duel, view, mode): open the respond prompt. */
    openRespondPrompt(duel: number, view: number, mode: number): void;
    /** F0x8008CFDC(duel, view): the respond prompt; the recorded answer, or -1. */
    tickRespondPrompt(duel: number, view: number): number;
    /** F0x8008D274(duel, view, side, filter): mark the board slots that pass a filter. */
    markFieldByFilter(duel: number, view: number, side: number, filter: number): void;
    /** F0x8008D594(duel, view): the multi-slot highlight; -1 while it is open. */
    tickMultiSlotHighlight(duel: number, view: number): number;
    /** F0x8008DDC0(duel, view, kind): play one effect on every marked board card. */
    playMarkedSlotFx(duel: number, view: number, kind: number): void;
    /** F0x8008DEAC(duel, view, frames): a plain frame timer; nonzero when it elapses. */
    waitFrames(duel: number, view: number, frames: number): number;
    /** F0x8008DEF8(duel, view, packedStats, mode): apply a packed attack/HP change. */
    queueStatChange(duel: number, view: number, packedStats: number, mode: number): void;
    /** F0x8008E08C(duel, view): walk the displayed stats toward the true ones. */
    statRampTick(duel: number, view: number): number;
    /** F0x8008E398(duel, view): mark the board cards a pending effect may target. */
    markEffectFieldTargets(duel: number, view: number): void;
    /** F0x8008E5B0(duel, view): start the hand shuffle. */
    effectOp4cEnterHandShuffle(duel: number, view: number): void;
    /** F0x8008E5BC(duel, view): the hand shuffle; nonzero when finished. */
    tickHandShuffle(duel: number, view: number): number;
    /** F0x8008EC44(duel, view, side, zone, mask): mark a pile by type mask. */
    markZoneByMask(duel: number, view: number, side: number, zone: number, mask: number): void;
    /** F0x8008EEC8(duel, view, side, mask): mark board cards by mask. */
    markFieldByMask(duel: number, view: number, side: number, mask: number): void;
    /** F0x8008F0B4(duel, view, side): start the sweep of a board into its discard. */
    effectOp49EnterSweepBoardToDiscard(duel: number, view: number, side: number): void;
    /** F0x8008F0F4(duel, view, side): the sweep; nonzero when finished. */
    tickSweepBoardToDiscard(duel: number, view: number, side: number): number;
    /** F0x8008F2D8(duel, view, delta, duration): an S-Energy counter change. */
    enterSEnergyDelta(duel: number, view: number, delta: number, duration: number): void;
    /** F0x8008F530(duel, view): start wiping every S-Energy counter. */
    effectOp29EnterZeroAllEnergy(duel: number, view: number): void;
    /** F0x8008F560(duel, view): the wipe; nonzero when every counter is empty. */
    tickZeroAllEnergy(duel: number, view: number): number;
    /** F0x8008F750(duel, view): start sending the resolving card back. */
    effectOp41EnterReturnResolvingCard(duel: number, view: number): void;
    /** F0x8008F790(duel, view): the return; nonzero when the card has landed. */
    tickReturnResolvingCard(duel: number, view: number): number;
    /** F0x8008F948(duel, view): request the resolving card's cut-in. */
    effectOp2aRequestCardCutIn(duel: number, view: number): number;
    /** F0x8008F978(duel, view, side, mode): open the zoomed single-card view. */
    openZoomedCard(duel: number, view: number, side: number, mode: number): void;
    /** F0x8008FA9C(duel, view, side, mode): the zoomed view; nonzero when it closes. */
    tickZoomedCardToDiscard(duel: number, view: number, side: number, mode: number): number;
    /** F0x8008FF08(duel, view, side, mode): draw a pile's top card onto the board. */
    drawPileCardToBoard(duel: number, view: number, side: number, mode: number): void;
    /** F0x80090058(duel, view, side, mode): the play-a-card sequence; nonzero when done. */
    tickPlayCardSequence(duel: number, view: number, side: number, mode: number): number;
    /** F0x8009076C(duel, view, side): start shuffling the discard back into the deck. */
    effectOp44EnterShuffleDiscardToDeck(duel: number, view: number, side: number): void;
    /** F0x800907AC(duel, view, side): the shuffle; nonzero when finished. */
    tickShuffleDiscardToDeck(duel: number, view: number, side: number): number;
    /** F0x80090A6C(duel, view, quota): clear every highlight and set the next quota. */
    clearMarksSetQuota(duel: number, view: number, quota: number): void;
    /** F0x80090A90(duel, view, side): mark the top N cards of a pile. */
    markTopNOfPile(duel: number, view: number, side: number): number;
    /** F0x80090BA0(duel, view, side): move every marked card onto the board. */
    effectOp48MoveMarkedToBoard(duel: number, view: number, side: number): void;
    /** F0x80090CD8(duel, view, side): that move's animation; nonzero when finished. */
    tickMoveMarkedToBoard(duel: number, view: number, side: number): number;
    /** F0x800915C4(duel, view): start discarding each marked card in turn. */
    enterDiscardMarked(duel: number, view: number): void;
    /** F0x800915D4(duel, view, mode): the discard; nonzero when finished. */
    tickDiscardMarked(duel: number, view: number, mode: number): number;
    /** F0x80091858(duel, view, side, mode): place a card in the next free slot. */
    placeCardOnField(duel: number, view: number, side: number, mode: number): void;
    /** F0x800919FC(duel, view, side): take a card off the board into a hand slot. */
    effectOp56ReturnCardToHand(duel: number, view: number, side: number): void;
    /** F0x80091C6C(duel, view, side): the three-stage landing; nonzero when done. */
    tickCardLand3(duel: number, view: number, side: number): number;
    /** F0x80091EB0(duel, view, side): copy a marked card's record into a slot. */
    effectOp57CopyMarkedCardToSlot(duel: number, view: number, side: number): void;
    /** F0x80092198(duel, view, side): the five-stage landing; nonzero when done. */
    tickCardLand5(duel: number, view: number, side: number): number;
    /** F0x80092438(duel, view, mode): open the resolving-card window. */
    openResolveWindow(duel: number, view: number, mode: number): void;
    /** F0x80092638(duel, view): the resolve sequence; nonzero when it is done. */
    tickResolveSequence(duel: number, view: number): number;
    /** F0x80092BA4(duel, view): clear both boards. */
    effectOp14ClearBothBoards(duel: number, view: number): void;
    /** F0x80092E60(duel, view): the deal / turn-start; nonzero when done. */
    tickDealTurnStart(duel: number, view: number): number;
    /** F0x80093624(duel, view, mode): start the damage transfer. */
    enterDamageTransfer(duel: number, view: number, mode: number): void;
    /** F0x80093710(duel, view, mode): the attack; nonzero when it is over. */
    tickAttackDrain(duel: number, view: number, mode: number): number;
    /** F0x80093ADC(duel, view, mode): start clearing the played row. */
    enterClearPlayedRow(duel: number, view: number, mode: number): void;
    /** F0x80093B10(duel, view, mode): clearing the played row; nonzero when done. */
    tickClearPlayedRow(duel: number, view: number, mode: number): number;
    /** F0x80093C18(duel, view): open the big sprite for the combo card. */
    effectOp1bOpenComboCard(duel: number, view: number): void;
    /** F0x80093CAC(duel, view): the combo sprite; nonzero when it is done. */
    tickComboCard(duel: number, view: number): number;
    /** F0x8009403C(duel, view, mode): build a fusion of the marked cards. */
    buildFusion(duel: number, view: number, mode: number): void;
    /** F0x800942DC(duel, view, mode): the fusion; nonzero when it is over. */
    tickFusion(duel: number, view: number, mode: number): number;
    /** F0x80094828(duel, view): clear the pending stat-change accumulators. */
    effectOp5aResetStatAccums(duel: number, view: number): void;
    /** F0x80094848(duel, view): re-add both rows; nonzero when the recount is over. */
    tickRecountTotals(duel: number, view: number): number;
    /** F0x80094B78(duel, view): reset the round-end counters. */
    resetRoundEndAccums(duel: number, view: number): void;
    /** F0x80094B9C(duel, view, mode): the round end; nonzero when it is over. */
    tickRoundEnd(duel: number, view: number, mode: number): number;
    /** F0x80094FDC(duel, view, message): show a banner. */
    showBanner(duel: number, view: number, message: number): void;
    /** F0x80095030(duel, view): the banner wait; nonzero when it is finished. */
    tickBannerWait(duel: number, view: number): number;
    /** F0x8009518C(duel, view, mode): pop one level off the resolution stack. */
    popPlayedStack(duel: number, view: number, mode: number): void;
    /** F0x80095208(duel, view): push one level; nonzero when the window is finished. */
    pushPlayedStack(duel: number, view: number): number;
    /** F0x80095274(duel, view, mode): pop, opening the window and setting the header. */
    popPlayedStackWithWindow(duel: number, view: number, mode: number): void;
    /** F0x800952F4(duel, view): push, waiting for the window instead of the pad. */
    pushPlayedStackWaitWindow(duel: number, view: number): number;
    /** F0x8009535C(duel, view): displayed stats step toward the true ones.
     *  Returns 0 on any call where a displayed byte moved; when nothing moved
     *  it returns 2 if duel+0x438 was set — the caller then latches opcode
     *  0x4D, the flagged-card removal — and 1 if 0x438 was clear. (claim
     *  cardgame-stat-ramp-and-death-mark-2026-10-10, verified) */
    effectOp5dTickStatSettle(duel: number, view: number): number;
}

/** F0x80084320 itself. */
export const RUN_EFFECT_OPCODE = 0x80084320;
/** The 174 enter-arm words, indexed by opcode - 1. */
export const EFFECT_ENTER_TABLE = 0x80082cf8;
/** The 175 update-arm words, indexed by the latched opcode byte. */
export const EFFECT_UPDATE_TABLE = 0x80082fb0;
/** The latch: copy 0x421 to 0x420 and clear 0x421 (0x80084EBC). */
export const EFFECT_VM_LATCH = 0x80084ebc;
/** The epilogue every update arm returns through (0x80085DC8). */
export const EFFECT_VM_EPILOGUE = 0x80085dc8;
/** The tail that writes 0x2F4 = 2 and returns (0x80085CE4). */
export const EFFECT_VM_TAIL_DONE = 0x80085ce4;
/** The tail that writes 0x2F4 = 0 and returns (0x80085DC4). */
export const EFFECT_VM_TAIL_YIELD = 0x80085dc4;
/** The executed enter arm: opcode 0xA6's phase banner (0x80084AF8). */
export const EFFECT_VM_ENTER_ARM_BANNER = 0x80084af8;
/** The executed update arm: the banner tick for opcodes 0x9F..0xA6 (0x80085B74). */
export const EFFECT_VM_UPDATE_ARM_BANNER = 0x80085b74;

/** Duel fields this function reads and writes. */
export const DUEL_PENDING_OPCODE = 0x421;
export const DUEL_LATCHED_OPCODE = 0x420;
export const DUEL_STEP = 0x2f4;
export const DUEL_PC = 0x4e0;
export const DUEL_REPEAT = 0x4e2;
export const DUEL_MARK = 0x4e4;
export const DUEL_PLAY_COUNT = 0x575;
export const DUEL_PLAYS = 0x584;
export const DUEL_COLOUR = 0x306;
export const DUEL_SCRATCH_424 = 0x424;
export const DUEL_SCRATCH_422 = 0x422;
export const DUEL_QUOTA = 0x444;
export const DUEL_SELECTED = 0x440;
export const DUEL_MARKED = 0x446;
export const DUEL_PICK_RESULT = 0x57a;
export const DUEL_RETURNED_CARD = 0x4dd;
export const DUEL_SIDE_STRIDE = 0xc8;
export const DUEL_HAND_COUNT = 0x5a6;
export const DUEL_HAND_IDS = 0x600;
export const DUEL_SELECTOR_B = 0x6c8;
export const DUEL_PLAYED_ATTR = 0x586;
export const DUEL_FIELD_SLOT = 0x59c;
export const DUEL_COLOUR_ACCUM = 0x50;

/** The per-call context: the two objects, the memory, and the four entry temps. */
export interface EffectVmContext {
    mem: EffectVmMemory;
    host: EffectVmHost;
    duel: number;
    view: number;
    /** `[duel + (playCount-1)*8 + 0x584]` — the previous play's side byte. */
    s2: number;
    /** `[duel + playCount*8 + 0x584]` — this play's side byte. */
    s3: number;
    /** `s2 ^ 1`. */
    s4: number;
}

const u16 = (mem: EffectVmMemory, addr: number): number => mem.read16(addr) & 0xffff;
const s16 = (mem: EffectVmMemory, addr: number): number => mem.read16s(addr) | 0;
const s8 = (mem: EffectVmMemory, addr: number): number => (mem.read8(addr) << 24) >> 24;

/** The latch at 0x80084EBC: 0x420 = u8(0x421); 0x421 = 0. */
export function latchEffectOpcode(c: EffectVmContext): void {
    const pending = c.mem.read8(c.duel + DUEL_PENDING_OPCODE) & 0xff;
    c.mem.write8(c.duel + DUEL_PENDING_OPCODE, 0);
    c.mem.write8(c.duel + DUEL_LATCHED_OPCODE, pending);
}

/** Every update arm's shared tail: write duel+0x2F4 and return. */
function tail(c: EffectVmContext, value: number): void {
    c.mem.write8(c.duel + DUEL_STEP, value);
}

/**
 * F0x80084320(duel, view). Runs at most one enter arm and one update arm; see
 * the file header for the two-phase shape.
 */
export function runEffectOpcode(mem: EffectVmMemory, host: EffectVmHost, duel: number, view: number): void {
    const playCount = s8(mem, duel + DUEL_PLAY_COUNT);
    const c: EffectVmContext = {
        mem,
        host,
        duel,
        view,
        s2: mem.read8(duel + (playCount - 1) * 8 + DUEL_PLAYS) & 0xff,
        s3: mem.read8(duel + playCount * 8 + DUEL_PLAYS) & 0xff,
        s4: 0,
    };
    c.s4 = c.s2 ^ 1;

    const pending = mem.read8(duel + DUEL_PENDING_OPCODE) & 0xff;
    if (pending !== 0) {
        if ((pending - 1) >>> 0 < 0xae) {
            const arm = (EFFECT_ENTER_WORDS[pending - 1] ?? 0) >>> 0;
            enterEffectArm(arm, c);
        } else {
            latchEffectOpcode(c);
        }
    }

    const latched = mem.read8(duel + DUEL_LATCHED_OPCODE) & 0xff;
    if (latched < 0xaf) {
        const arm = (EFFECT_UPDATE_WORDS[latched] ?? 0) >>> 0;
        updateEffectArm(arm, c);
    }
}

/**
 * The 122 distinct enter arms the 174-word table at 0x80082CF8 can jump to.
 * Every one of them ends at the latch (0x80084EBC), which is also a table word
 * itself (42 opcodes have no enter arm of their own).
 */
export function enterEffectArm(arm: number, c: EffectVmContext): void {
    const { mem, host, duel, view, s2, s3, s4 } = c;
    switch (arm) {
        case 0x800843a0: // op 0x01
            mem.write8(duel + DUEL_SCRATCH_424, 0x2d);
            break;
        case 0x800843ac: // op 0x12
            host.openResolveWindow(duel, view, 0);
            break;
        case 0x800843c4: // op 0x13
            host.openResolveWindow(duel, view, 1);
            break;
        case 0x800843dc: // op 0x14
            host.effectOp14ClearBothBoards(duel, view);
            break;
        case 0x800843f0: // op 0x1B
            host.effectOp1bOpenComboCard(duel, view);
            break;
        case 0x80084404: // op 0x15
            host.enterDamageTransfer(duel, view, 0);
            break;
        case 0x8008441c: // op 0x16
            host.enterDamageTransfer(duel, view, 1);
            break;
        case 0x80084434: // op 0x17
            host.enterClearPlayedRow(duel, view, 0);
            break;
        case 0x8008444c: // op 0x18
            host.enterClearPlayedRow(duel, view, 1);
            break;
        case 0x80084464: // op 0x19
            host.buildFusion(duel, view, 0);
            break;
        case 0x8008447c: // op 0x1A
            host.buildFusion(duel, view, 1);
            break;
        case 0x80084494: // ops 0x1C, 0x1D
            host.resetRoundEndAccums(duel, view);
            break;
        case 0x800844a8: // ops 0x1E, 0x1F, 0x20, 0x22, 0x23
            host.enterSEnergyDelta(duel, view, 1, 0x1e);
            break;
        case 0x800844b8: // op 0x21
            host.enterSEnergyDelta(duel, view, 2, 0x1e);
            break;
        case 0x800844c8: // ops 0x24..0x28
            host.enterSEnergyDelta(duel, view, -2, 0x1e);
            break;
        case 0x800844e4: // op 0x29
            host.effectOp29EnterZeroAllEnergy(duel, view);
            break;
        case 0x800844f8: // op 0x2F
            host.showBanner(duel, view, 0x39);
            break;
        case 0x80084510: // op 0x30
            host.showBanner(duel, view, 0x35);
            break;
        case 0x80084528: // op 0x31
            if (s2 === 0) host.showBanner(duel, view, 0x3b);
            break;
        case 0x80084544: // op 0x2B
            host.popPlayedStack(duel, view, 0);
            break;
        case 0x8008455c: // op 0x2D
            host.popPlayedStack(duel, view, 1);
            break;
        case 0x80084574: // op 0x2C
            host.popPlayedStackWithWindow(duel, view, 0);
            break;
        case 0x8008458c: // op 0x2E
            host.popPlayedStackWithWindow(duel, view, 1);
            break;
        case 0x800845a4: // op 0x3E
            host.openZoomedCard(duel, view, s4, 0);
            break;
        case 0x800845b4: // op 0x3F
            host.openZoomedCard(duel, view, s2, 0);
            break;
        case 0x800845d0: // op 0x40
            host.openZoomedCard(duel, view, s4, 1);
            break;
        case 0x800845ec: // op 0x41
            host.effectOp41EnterReturnResolvingCard(duel, view);
            break;
        case 0x80084600: // op 0x42
            host.drawPileCardToBoard(duel, view, s2, 3);
            break;
        case 0x8008461c: // op 0x43
            host.drawPileCardToBoard(duel, view, s2, 4);
            break;
        case 0x80084638: // op 0x44
            host.effectOp44EnterShuffleDiscardToDeck(duel, view, s2);
            break;
        case 0x80084650: // op 0x45
            host.clearMarksSetQuota(duel, view, 2);
            break;
        case 0x80084668: { // op 0x46
            let quota = (3 - s16(mem, duel + s2 * DUEL_SIDE_STRIDE + DUEL_HAND_COUNT)) | 0;
            if (quota <= 0) quota = 0;
            host.clearMarksSetQuota(duel, view, quota);
            break;
        }
        case 0x800846a8: // op 0x47
            host.clearMarksSetQuota(duel, view, 6);
            break;
        case 0x800846c0: // op 0x48
            host.effectOp48MoveMarkedToBoard(duel, view, s2);
            break;
        case 0x800846d8: // op 0x49
            host.effectOp49EnterSweepBoardToDiscard(duel, view, s2);
            break;
        case 0x800846f0: // op 0x4C
            host.effectOp4cEnterHandShuffle(duel, view);
            break;
        case 0x80084704: // ops 0x4D, 0x4E
            host.enterDiscardMarked(duel, view);
            break;
        case 0x80084718: // op 0x5D
            mem.write8(duel + DUEL_SCRATCH_422, 1);
            break;
        case 0x80084724: // op 0x5A
            host.effectOp5aResetStatAccums(duel, view);
            break;
        case 0x80084738: // op 0x4F
            host.placeCardOnField(duel, view, s2, 0x50);
            break;
        case 0x80084754: // op 0x50
            host.placeCardOnField(duel, view, s2, 0x51);
            break;
        case 0x80084770: // op 0x51
            host.placeCardOnField(duel, view, s2, 0x52);
            break;
        case 0x8008478c: // op 0x52
            host.placeCardOnField(duel, view, s2, 0x53);
            break;
        case 0x800847a8: // op 0x53
            host.placeCardOnField(duel, view, s2, 0x54);
            break;
        case 0x800847c4: // op 0x54
            host.placeCardOnField(duel, view, s2, 0x55);
            break;
        case 0x800847e0: // op 0x55
            host.placeCardOnField(duel, view, s2, 0x56);
            break;
        case 0x800847fc: // op 0x56
            host.effectOp56ReturnCardToHand(duel, view, s2);
            break;
        case 0x80084814: // op 0x57
            host.effectOp57CopyMarkedCardToSlot(duel, view, s2);
            break;
        case 0x8008482c: // op 0x58
            host.playMarkedSlotFx(duel, view, 0);
            break;
        case 0x80084844: // op 0x59
            host.playMarkedSlotFx(duel, view, 1);
            break;
        case 0x8008485c: // op 0x5E
            host.queueStatChange(duel, view, 0xa000a, 1);
            break;
        case 0x80084870: // op 0x5F
            host.queueStatChange(duel, view, 0x1e, 1);
            break;
        case 0x80084880: // op 0x60
            host.queueStatChange(duel, view, 0x320032, 1);
            break;
        case 0x80084894: // op 0x61
            host.queueStatChange(duel, view, 0x140014, 1);
            break;
        case 0x800848a8: // op 0x62
            host.queueStatChange(duel, view, 0x1e001e, 1);
            break;
        case 0x800848bc: // op 0x63
            host.queueStatChange(duel, view, 0xa, 1);
            break;
        case 0x800848cc: // op 0x64
            host.queueStatChange(duel, view, 0xa0000, 1);
            break;
        case 0x800848e8: // op 0x65
            host.queueStatChange(duel, view, 0xffc4, 0);
            break;
        case 0x800848f8: // op 0x66
            host.queueStatChange(duel, view, 0xfff1, 0);
            break;
        case 0x80084908: // op 0x67
            host.queueStatChange(duel, view, 0xffe2, 0);
            break;
        case 0x80084918: // op 0x68
            host.queueStatChange(duel, view, 0xafff6, 0);
            break;
        case 0x80084938: // op 0x69
            host.queueStatChange(duel, view, 0xff9d0000, 2);
            break;
        case 0x80084954: // op 0x6A
            mem.write8(duel + DUEL_COLOUR, 1);
            mem.write8(duel + DUEL_SCRATCH_424, 0xa);
            break;
        case 0x8008495c: // op 0x6B
            mem.write8(duel + DUEL_COLOUR, 2);
            mem.write8(duel + DUEL_SCRATCH_424, 0xa);
            break;
        case 0x80084964: // op 0x6C
            mem.write8(duel + DUEL_COLOUR, 3);
            mem.write8(duel + DUEL_SCRATCH_424, 0xa);
            break;
        case 0x8008496c: // op 0x6D
            mem.write8(duel + DUEL_COLOUR, 4);
            mem.write8(duel + DUEL_SCRATCH_424, 0xa);
            break;
        case 0x80084974: // op 0x6E
            mem.write8(duel + DUEL_COLOUR, 5);
            mem.write8(duel + DUEL_SCRATCH_424, 0xf);
            break;
        case 0x80084988: // op 0x6F
            mem.write8(duel + DUEL_COLOUR, 6);
            mem.write8(duel + DUEL_SCRATCH_424, 0xa);
            break;
        case 0x8008499c: // op 0x98
            host.effectOp98OpenOwnFieldPicker(duel, view, 0xe);
            break;
        case 0x800849b4: // op 0x9B
            host.openBrowsePicker(duel, view, s16(mem, duel + DUEL_HAND_COUNT), 5);
            break;
        case 0x800849d0: // op 0x9C
            host.openBrowsePicker(duel, view, s16(mem, duel + 0x5a2), 9);
            break;
        case 0x800849ec: // op 0xA8
            host.effectOpA8EnterTwoHandCompare(duel, view);
            break;
        case 0x80084a00: // op 0x9A
            host.openLegalRowPicker(duel, view, duel + DUEL_FIELD_SLOT);
            break;
        case 0x80084a18: // op 0x9D
            mem.write8(duel + DUEL_QUOTA, 0);
            break;
        case 0x80084a20: // op 0x9E
            host.effectOp9eOpenScoreScreen(duel, view);
            break;
        case 0x80084a34: // op 0x99
            host.openLegalRowPicker(
                duel,
                view,
                duel + (mem.read8(duel + 0x579) & 0xff) * DUEL_SIDE_STRIDE + DUEL_FIELD_SLOT,
            );
            break;
        case 0x80084a68: // ops 0x9F, 0xA0
            host.showPhaseBanner(duel, view, 0);
            break;
        case 0x80084a80: // op 0xA1
            host.showPhaseBanner(duel, view, 1);
            break;
        case 0x80084a98: // op 0xA2
            host.showPhaseBanner(duel, view, 2);
            break;
        case 0x80084ab0: // op 0xA3
            host.showPhaseBanner(duel, view, 3);
            break;
        case 0x80084ac8: // op 0xA4
            host.showPhaseBanner(duel, view, 4);
            break;
        case 0x80084ae0: // op 0xA5
            host.showPhaseBanner(duel, view, 5);
            break;
        case 0x80084af8: // op 0xA6
            host.showPhaseBanner(duel, view, 6);
            break;
        case 0x80084b10: // op 0xA7
            host.effectOpA7StartCoinToss(duel, view);
            break;
        case 0x80084b24: // op 0xAC
            host.openPilePicker(duel, view, s2, 2);
            break;
        case 0x80084b40: // op 0xAD
            host.openPilePicker(duel, view, s4, 1);
            break;
        case 0x80084b5c: // op 0xA9
            host.openPilePicker(duel, view, s4, 0);
            break;
        case 0x80084b6c: // op 0xAA
            host.openPilePicker(duel, view, s2, 0);
            break;
        case 0x80084b88: // op 0xAB
            host.openPilePicker(duel, view, s2, 3);
            break;
        case 0x80084ba4: // op 0xAE
            host.enterTwoHandCompareMode(duel, view, 0);
            break;
        case 0x80084bbc: // op 0x70
            host.openChoosePilePrompt(duel, view, 0);
            break;
        case 0x80084bd4: // op 0x71
            host.openChoosePilePrompt(duel, view, 0x4000);
            break;
        case 0x80084bec: // op 0x72
            host.openChoosePilePrompt(duel, view, 0x2000);
            break;
        case 0x80084c04: // op 0x73
            host.openChoosePilePrompt(duel, view, 1);
            break;
        case 0x80084c1c: // op 0x74
            host.openChoosePilePrompt(duel, view, 4);
            break;
        case 0x80084c34: // op 0x75
            host.openChoosePilePrompt(duel, view, 0x10);
            break;
        case 0x80084c4c: // op 0x76
            host.openChoosePilePrompt(duel, view, 0x40);
            break;
        case 0x80084c64: // op 0x77
            host.openChoosePilePrompt(duel, view, 0x100);
            break;
        case 0x80084c7c: // op 0x78
            host.openChoosePilePrompt(duel, view, 2);
            break;
        case 0x80084c94: // op 0x79
            host.openChoosePilePrompt(duel, view, 8);
            break;
        case 0x80084cac: // op 0x7A
            host.openChoosePilePrompt(duel, view, 0x20);
            break;
        case 0x80084cc4: // op 0x7B
            host.openChoosePilePrompt(duel, view, 0x80);
            break;
        case 0x80084cdc: // op 0x7C
            host.openChoosePilePrompt(duel, view, 0x200);
            break;
        case 0x80084cf4: // op 0x7D
            host.openChoosePilePrompt(duel, view, 0x3ff);
            break;
        case 0x80084d0c: // op 0x7E
            host.openChoosePilePrompt(duel, view, 0xf0000);
            break;
        case 0x80084d24: // op 0x7F
            host.openChoosePilePrompt(duel, view, 0x8000);
            break;
        case 0x80084d3c: // op 0x81
            host.openChoosePilePrompt(duel, view, 0x400);
            break;
        case 0x80084d54: // op 0x80
            host.openChoosePilePrompt(duel, view, 0x1400);
            break;
        case 0x80084d6c: // op 0x82
            host.openChoosePilePrompt(duel, view, 0x1000);
            break;
        case 0x80084d84: // op 0x83
            host.openRespondPrompt(duel, view, 0);
            break;
        case 0x80084d9c: // op 0x84
            host.openRespondPrompt(duel, view, 1);
            break;
        case 0x80084db4: // op 0x8D
            host.enterTwoHandCompareMode(duel, view, 1);
            break;
        case 0x80084dcc: // op 0x8E
            host.markFieldByFilter(duel, view, s3, 1);
            break;
        case 0x80084de8: // op 0x8F
            host.markFieldByFilter(duel, view, s3, 2);
            break;
        case 0x80084e04: // op 0x90
            host.markFieldByFilter(duel, view, s3, 3);
            break;
        case 0x80084e20: // op 0x91
            host.markFieldByFilter(duel, view, s3, 4);
            break;
        case 0x80084e3c: // op 0x92
            host.markFieldByFilter(duel, view, s3, 5);
            break;
        case 0x80084e58: // op 0x93
            host.markFieldByFilter(duel, view, s3, 6);
            break;
        case 0x80084e74: // op 0x94
            host.markFieldByFilter(duel, view, s3, 7);
            break;
        case 0x80084e90: // op 0x95
            host.markFieldByFilter(duel, view, s3, 8);
            break;
        case 0x80084eac: // op 0x97
            host.openPilePickerKind0(duel, view, s3);
            break;
        case EFFECT_VM_LATCH:
            break;
        default:
            throw new Error(`effect vm: no enter arm at 0x${arm.toString(16)}`);
    }
    latchEffectOpcode(c);
}

/**
 * The 105 distinct update arms the 175-word table at 0x80082FB0 can jump to.
 * Update word 0 is the epilogue itself (no store), which is why opcode 0x00 can
 * pass through with nothing to do.
 */
export function updateEffectArm(arm: number, c: EffectVmContext): void {
    const { mem, host, duel, view, s2, s3, s4 } = c;
    switch (arm) {
        case 0x80084ef8: // op 0x01
            if (host.pollEffectTimer(duel, view) !== 0) tail(c, 2);
            return;
        case 0x80084f14: // op 0x02
            tail(c, 2);
            mem.write16(duel + DUEL_PC, (u16(mem, duel + DUEL_PC) + 2) & 0xffff);
            return;
        case 0x80084f2c: // op 0x03
            mem.write16(duel + DUEL_REPEAT, 2);
            tail(c, 2);
            mem.write16(duel + DUEL_MARK, u16(mem, duel + DUEL_PC));
            return;
        case 0x80084f3c: // op 0x04
            mem.write16(duel + DUEL_REPEAT, 3);
            tail(c, 2);
            mem.write16(duel + DUEL_MARK, u16(mem, duel + DUEL_PC));
            return;
        case 0x80084f48: // op 0x05
            mem.write16(duel + DUEL_REPEAT, 5);
            tail(c, 2);
            mem.write16(duel + DUEL_MARK, u16(mem, duel + DUEL_PC));
            return;
        case 0x80084f64: { // op 0x06
            const left = (u16(mem, duel + DUEL_REPEAT) - 1) & 0xffff;
            mem.write16(duel + DUEL_REPEAT, left);
            if (((left << 16) | 0) > 0) mem.write16(duel + DUEL_PC, u16(mem, duel + DUEL_MARK));
            tail(c, 2);
            return;
        }
        case 0x80084f8c: // op 0x07
            host.branchIfActingSide(duel, view, 1, 1);
            tail(c, 2);
            return;
        case 0x80084fa8: // op 0x08
            host.branchIfActingSide(duel, view, 1, 2);
            tail(c, 2);
            return;
        case 0x80084fd8: { // op 0x0F
            // For each card in the s4 side's hand, fetch its catalogue record
            // and compare the colour byte; the first non-black card jumps back 4.
            const cursor = host.cardRecordCursorCreate();
            const stride = s4 * DUEL_SIDE_STRIDE;
            if (s16(mem, duel + stride + DUEL_HAND_COUNT) <= 0) {
                tail(c, 2);
                return;
            }
            let card = 0;
            for (;;) {
                const id = s16(mem, duel + stride + card * 2 + DUEL_HAND_IDS);
                const recordIndex = (s16(mem, duel + id * 2 + DUEL_COLOUR_ACCUM) + 1) | 0;
                host.cardRecordSelect(cursor, recordIndex);
                if ((mem.read8(host.cardRecordPointer(cursor)) & 0xff) !== 5) {
                    mem.write16(duel + DUEL_PC, (u16(mem, duel + DUEL_PC) - 4) & 0xffff);
                    tail(c, 2);
                    return;
                }
                card++;
                if (!(card < s16(mem, duel + stride + DUEL_HAND_COUNT))) {
                    tail(c, 2);
                    return;
                }
            }
        }
        case 0x8008507c: // op 0x09
            host.branchIfHandAtMost(duel, s2, 0xa, 9);
            tail(c, 2);
            return;
        case 0x80085098: // op 0x0A
            host.branchIfHandOver(duel, s2, 0xa, -9);
            tail(c, 2);
            return;
        case 0x800850b4: // op 0x0B
            host.branchIfHandAtMost(duel, s2, 3, 9);
            tail(c, 2);
            return;
        case 0x800850d0: // op 0x0C
            host.branchIfHandOver(duel, s2, 3, -9);
            tail(c, 2);
            return;
        case 0x800850ec: // op 0x10
            host.effectOp10BranchIfFieldUnderSix(duel, s2, 5);
            tail(c, 2);
            return;
        case 0x80085104: // op 0x0D
            host.branchIfHandOver(duel, s2, 2, 4);
            tail(c, 2);
            return;
        case 0x80085120: // op 0x0E
            host.effectOp0eBranchIfFolderNonempty(duel, s4, 2);
            tail(c, 2);
            return;
        case 0x80085138: { // op 0x11
            const addr = duel + (s8(mem, duel + DUEL_PLAY_COUNT) - 1) * 8 + DUEL_PLAYS;
            mem.write8(addr, (mem.read8(addr) & 0xff) ^ 1);
            tail(c, 2);
            return;
        }
        case 0x80085160: // ops 0x12, 0x13
            if (host.tickResolveSequence(duel, view) !== 0) tail(c, 0);
            return;
        case 0x8008517c: // op 0x14
            if (host.tickDealTurnStart(duel, view) !== 0) tail(c, 0);
            return;
        case 0x80085198: // op 0x1B
            if (host.tickComboCard(duel, view) !== 0) tail(c, 0);
            return;
        case 0x800851b4: // op 0x15
            if (host.tickAttackDrain(duel, view, 0) !== 0) tail(c, 0);
            return;
        case 0x800851d4: // op 0x16
            if (host.tickAttackDrain(duel, view, 1) !== 0) tail(c, 0);
            return;
        case 0x800851f4: // op 0x17
            if (host.tickClearPlayedRow(duel, view, 0) !== 0) tail(c, 0);
            return;
        case 0x80085214: // op 0x18
            if (host.tickClearPlayedRow(duel, view, 1) !== 0) tail(c, 0);
            return;
        case 0x80085234: // op 0x19
            if (host.tickFusion(duel, view, 0) !== 0) tail(c, 0);
            return;
        case 0x80085254: // op 0x1A
            if (host.tickFusion(duel, view, 1) !== 0) tail(c, 0);
            return;
        case 0x80085274: // op 0x1C
            if (host.tickRoundEnd(duel, view, 0) !== 0) tail(c, 0);
            return;
        case 0x80085294: // op 0x1D
            if (host.tickRoundEnd(duel, view, 1) !== 0) tail(c, 0);
            return;
        case 0x800852b4: // ops 0x1E..0x28
            if (host.playSEnergyFlourish(duel, view) !== 0) tail(c, 2);
            return;
        case 0x800852d0: // op 0x29
            if (host.tickZeroAllEnergy(duel, view) !== 0) tail(c, 2);
            return;
        case 0x800852ec: // op 0x2A
            if (host.effectOp2aRequestCardCutIn(duel, view) !== 0) tail(c, 2);
            return;
        case 0x80085308: // ops 0x2B, 0x2D
            if (host.pushPlayedStack(duel, view) !== 0) tail(c, 2);
            return;
        case 0x80085324: // ops 0x2C, 0x2E
            if (host.pushPlayedStackWaitWindow(duel, view) !== 0) tail(c, 2);
            return;
        case 0x80085340: // op 0x2F
            if (s2 !== 0) {
                tail(c, 2);
                return;
            }
            if (host.tickBannerWait(duel, view) !== 0) tail(c, 2);
            return;
        case 0x80085364: // op 0x30
            if (host.tickBannerWait(duel, view) !== 0) tail(c, 2);
            return;
        case 0x80085380: // op 0x31
            if (s2 !== 0) {
                tail(c, 2);
                return;
            }
            if (host.tickBannerWait(duel, view) !== 0) tail(c, 2);
            return;
        case 0x800853a4: // op 0x34
            host.markZoneByMask(duel, view, s2, 3, 0xfd);
            tail(c, 2);
            return;
        case 0x800853c8: // op 0x35
            host.markZoneByMask(duel, view, s2, 3, 0xfe);
            tail(c, 2);
            return;
        case 0x800853ec: // op 0x32
            host.markZoneByMask(duel, view, s2, 3, 0xff);
            tail(c, 2);
            return;
        case 0x80085410: // op 0x33
            host.markZoneByMask(duel, view, s4, 3, 0xff);
            tail(c, 2);
            return;
        case 0x80085434: // op 0x37
            host.markZoneByMask(duel, view, s2, 2, 0xff);
            tail(c, 2);
            return;
        case 0x80085458: // op 0x36
            host.markZoneByMask(duel, view, s4, 2, 0xff);
            tail(c, 2);
            return;
        case 0x8008547c: // op 0x38
            host.markZoneByMask(duel, view, s4, 2, 0x81);
            tail(c, 2);
            return;
        case 0x800854a0: // op 0x39
            host.markZoneByMask(duel, view, s4, 2, 0xbf);
            tail(c, 2);
            return;
        case 0x800854c4: // op 0x3A
            host.markZoneByMask(duel, view, s2, 4, 0xff);
            tail(c, 2);
            return;
        case 0x800854e8: // op 0x3B
            host.markFieldByMask(duel, view, s2, 0x3fc);
            tail(c, 2);
            return;
        case 0x80085504: // op 0x3C
            host.markFieldByMask(duel, view, s2, 0x2fc);
            tail(c, 2);
            return;
        case 0x80085520: // op 0x3D
            host.markFieldByMask(duel, view, s2, 0x1fc);
            tail(c, 2);
            return;
        case 0x8008553c: // op 0x3E
            if (host.tickZoomedCardToDiscard(duel, view, s4, 0) !== 0) tail(c, 2);
            return;
        case 0x80085560: // op 0x3F
            if (host.tickZoomedCardToDiscard(duel, view, s2, 0) !== 0) tail(c, 2);
            return;
        case 0x80085584: // op 0x40
            if (host.tickZoomedCardToDiscard(duel, view, s4, 1) !== 0) tail(c, 2);
            return;
        case 0x800855a8: // op 0x41
            if (host.tickReturnResolvingCard(duel, view) !== 0) {
                mem.write8(duel + DUEL_RETURNED_CARD, 1);
                tail(c, 2);
            }
            return;
        case 0x800855c4: // op 0x42
            if (host.tickPlayCardSequence(duel, view, s2, 3) !== 0) tail(c, 2);
            return;
        case 0x800855e8: // op 0x43
            if (host.tickPlayCardSequence(duel, view, s2, 4) !== 0) tail(c, 2);
            return;
        case 0x8008560c: // op 0x44
            if (host.tickShuffleDiscardToDeck(duel, view, s2) !== 0) tail(c, 2);
            return;
        case 0x8008562c: // ops 0x45..0x47
            if (host.markTopNOfPile(duel, view, s2) !== 0) tail(c, 2);
            return;
        case 0x8008564c: // op 0x48
            if (host.tickMoveMarkedToBoard(duel, view, s2) !== 0) tail(c, 2);
            return;
        case 0x8008566c: // op 0x49
            if (host.tickSweepBoardToDiscard(duel, view, s2) !== 0) tail(c, 2);
            return;
        case 0x80085694: { // op 0x4A
            const stride = s4 * DUEL_SIDE_STRIDE;
            const count = s16(mem, duel + stride + DUEL_HAND_COUNT);
            if (count > 0) {
                for (let card = 0; card < count; card++) {
                    if ((mem.read8(duel + card + DUEL_MARKED) & 0xff) !== 0) {
                        mem.write32(duel + DUEL_SELECTED, card);
                        break;
                    }
                }
            }
            tail(c, 2);
            return;
        }
        case 0x800856ec: // op 0x4B
            host.effectOp4bPickSelectionBySide(duel, view, s4);
            tail(c, 2);
            return;
        case 0x80085704: // op 0x4C
            if (host.tickHandShuffle(duel, view) !== 0) tail(c, 2);
            return;
        case 0x80085720: // op 0x4D
            if (host.tickDiscardMarked(duel, view, 0) !== 0) tail(c, 2);
            return;
        case 0x80085740: // op 0x4E
            if (host.tickDiscardMarked(duel, view, 1) !== 0) tail(c, 2);
            return;
        case 0x80085760: // ops 0x4F..0x56
            if (host.tickCardLand3(duel, view, s2) !== 0) tail(c, 2);
            return;
        case 0x80085780: // op 0x57
            if (host.tickCardLand5(duel, view, s2) !== 0) tail(c, 2);
            return;
        case 0x800857a0: // op 0x58
            if (host.waitFrames(duel, view, 0x24) !== 0) tail(c, 2);
            return;
        case 0x800857c0: // op 0x59
            if (host.waitFrames(duel, view, 0x1c) !== 0) tail(c, 2);
            return;
        case 0x800857e0: // op 0x5A
            if (host.tickRecountTotals(duel, view) !== 0) tail(c, 2);
            return;
        case 0x800857fc: // op 0x5B
            host.markSlotsMatchingEffectAttr(duel, view);
            tail(c, 2);
            return;
        case 0x80085810: // op 0x5C
            host.markEffectFieldTargets(duel, view);
            tail(c, 2);
            return;
        case 0x80085824: { // op 0x5D
            const code = host.effectOp5dTickStatSettle(duel, view);
            if (code === 1) {
                tail(c, 2);
                return;
            }
            if (code === 2) mem.write8(duel + DUEL_PENDING_OPCODE, 0x4d);
            return;
        }
        case 0x80085850: // ops 0x5E..0x69
            if (host.statRampTick(duel, view) !== 0) tail(c, 2);
            return;
        case 0x8008586c: // ops 0x6A..0x6F
            if (host.pollEffectTimer(duel, view) !== 0) tail(c, 2);
            return;
        case 0x80085888: // ops 0x70..0x7E
        case 0x800858ac: // op 0x7F
        case 0x800858d0: { // ops 0x80..0x82
            const pick = host.tickChoosePilePrompt(duel, view);
            if (pick === -1) return;
            mem.write8(duel + DUEL_PICK_RESULT, pick & 0xff);
            tail(c, 0);
            return;
        }
        case 0x800858f4: { // ops 0x83, 0x84
            const pick = host.tickRespondPrompt(duel, view);
            if (pick === -1) return;
            mem.write8(duel + DUEL_PICK_RESULT, pick & 0xff);
            tail(c, 0);
            return;
        }
        case 0x80085918: // op 0x87
            effectOp85To8cArm(c, 0x180);
            return;
        case 0x8008592c: // op 0x86
            effectOp85To8cArm(c, 0x1bc);
            return;
        case 0x80085940: // op 0x85
            effectOp85To8cArm(c, 0x1fc);
            return;
        case 0x80085954: // op 0x8A
            effectOp85To8cArm(c, 0x280);
            return;
        case 0x80085968: // op 0x89
            effectOp85To8cArm(c, 0x2bc);
            return;
        case 0x8008597c: // op 0x88
            effectOp85To8cArm(c, 0x2fc);
            return;
        case 0x80085990: // op 0x8B
            effectOp85To8cArm(c, 0x3fc);
            return;
        case 0x800859a4: // op 0x8C
            effectOp85To8cArm(c, 0x380);
            return;
        case 0x800859c8: { // op 0x8D
            const code = host.tickTwoHandComparePick(duel, view);
            if (code === 1) {
                mem.write8(duel + DUEL_PICK_RESULT, 0);
                tail(c, 0);
                return;
            }
            if (code === 2) {
                const slot = mem.read32(duel + DUEL_SELECTED) | 0;
                const value =
                    slot < 6
                        ? mem.read8(duel + slot * 0x0e + 0x73a) & 0xff
                        : mem.read8(duel + (slot - 6) * 0x0e + 0x7ac) & 0xff;
                mem.write8(duel + s8(mem, duel + DUEL_PLAY_COUNT) * 8 + DUEL_PLAYED_ATTR, value);
                mem.write8(duel + DUEL_PICK_RESULT, 1);
                tail(c, 0);
            }
            return;
        }
        case 0x80085a50: { // op 0x98
            const code = host.tickYesNoConfirm(duel, view);
            if (code === 1) {
                mem.write8(duel + DUEL_PICK_RESULT, code & 0xff);
                tail(c, 0);
                return;
            }
            if ((code >>> 0) < 2) return;
            if (code === 2) {
                mem.write8(duel + DUEL_PICK_RESULT, 0);
                tail(c, 0);
            }
            return;
        }
        case 0x80085a94: { // op 0x99
            const pick = host.tickCardPicker(
                duel,
                view,
                duel + (mem.read8(duel + 0x579) & 0xff) * DUEL_SIDE_STRIDE + DUEL_FIELD_SLOT,
            );
            if (pick === -1) return;
            mem.write8(duel + DUEL_PICK_RESULT, pick & 0xff);
            tail(c, 0);
            return;
        }
        case 0x80085ad8: // op 0x9A
            if (host.tickCardPicker(duel, view, duel + DUEL_FIELD_SLOT) !== -1) tail(c, 0);
            return;
        case 0x80085afc: // op 0x9D
            if (host.effectOp9dAutoPickLegalSummons(duel, view) !== 0) tail(c, 0);
            return;
        case 0x80085b18: // ops 0x9B, 0x9C
            if (host.tickCardPicker(duel, view, duel + DUEL_FIELD_SLOT) !== -1) tail(c, 3);
            return;
        case 0x80085b3c: // op 0xA8
            if (host.tickTwoHandCompare(duel, view) !== 0) tail(c, 3);
            return;
        case 0x80085b58: // op 0x9E
            if (host.tickScoreScreen(duel, view) !== 0) tail(c, 0);
            return;
        case 0x80085b74: // ops 0x9F..0xA6
            if (host.tickPhaseBanner(duel, view) !== 0) tail(c, 0);
            return;
        case 0x80085b90: // op 0xA7
            if (host.tickCoinToss(duel, view) !== 0) tail(c, 0);
            return;
        case 0x80085bac: // op 0xAC
            if (s2 !== 0) {
                host.aiPickFirstLegalPileCard(duel, view);
                tail(c, 2);
                return;
            }
            if (host.tickPilePicker(duel, view, 2) !== 0) tail(c, 2);
            return;
        case 0x80085be0: // op 0xAD
            if (s2 !== 0) {
                host.aiPickLowestStatPileCard(duel, view);
                tail(c, 2);
                return;
            }
            if (host.tickPilePicker(duel, view, 0) !== 0) tail(c, 2);
            return;
        case 0x80085c14: // op 0xA9
            if (s2 !== 0) {
                host.aiHandPick(duel, view, 1);
                tail(c, 2);
                return;
            }
            if (host.tickPilePicker(duel, view, 0) !== 0) tail(c, 2);
            return;
        case 0x80085c4c: // op 0xAA
            if (s2 !== 0) {
                host.aiHandPick(duel, view, 0);
                tail(c, 2);
                return;
            }
            if (host.tickPilePicker(duel, view, 0) !== 0) tail(c, 2);
            return;
        case 0x80085c84: // op 0xAB
            if (s2 !== 0) {
                host.aiHandPick(duel, view, 1);
                tail(c, 2);
                return;
            }
            if (host.tickPilePicker(duel, view, 0) !== 0) tail(c, 2);
            return;
        case 0x80085cbc: // op 0xAE
            if (s2 !== 0) {
                host.aiPickBestOppFieldSlot(duel);
                tail(c, 2);
                return;
            }
            if (host.tickTwoHandComparePick(duel, view) !== 0) tail(c, 2);
            return;
        case 0x80085cf0: { // ops 0x8E..0x95
            const pick = host.tickMultiSlotHighlight(duel, view);
            if (pick === -1) return;
            mem.write8(duel + DUEL_PICK_RESULT, pick & 0xff);
            tail(c, 0);
            return;
        }
        case 0x80085d14: // op 0x96
            host.markZoneByMask(duel, view, s3, 2, 0xfd);
            mem.write8(duel + DUEL_PENDING_OPCODE, 0x97);
            return;
        case 0x80085d3c: { // op 0x97
            const code = host.tickPilePicker(duel, view, 1);
            if (code === 1) {
                mem.write8(duel + DUEL_PICK_RESULT, 0);
                tail(c, 0);
                return;
            }
            if (code !== 2) return;
            const slot = mem.read32(duel + DUEL_SELECTED) | 0;
            const value =
                s3 === 0
                    ? mem.read16(duel + slot * 2 + DUEL_HAND_IDS)
                    : mem.read16(duel + slot * 2 + DUEL_SELECTOR_B);
            mem.write8(duel + s8(mem, duel + DUEL_PLAY_COUNT) * 8 + DUEL_PLAYED_ATTR, value & 0xff);
            mem.write8(duel + DUEL_PICK_RESULT, 1);
            tail(c, 0);
            return;
        }
        case EFFECT_VM_EPILOGUE: // opcode 0x00 in the update table
            return;
        default:
            throw new Error(`effect vm: no update arm at 0x${arm.toString(16)}`);
    }
}

/** Ops 0x85..0x8C (and 0x87): mark the field by mask, then queue opcode 0x8D. */
function effectOp85To8cArm(c: EffectVmContext, mask: number): void {
    c.host.markFieldByMask(c.duel, c.view, c.s3, mask);
    c.mem.write8(c.duel + DUEL_PENDING_OPCODE, 0x8d);
}
