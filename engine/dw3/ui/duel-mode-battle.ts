// The three remaining duel mode updates the mode machine (duel-mode-machine.ts)
// dispatches into: the Battle Phase (mode 5/7), mode 6, and the Set-End Phase
// (mode 8). Each is a jump-table dispatcher read from the overlay ASSEMBLY
// (authority 2), never the m2c C — which merges physically interleaved
// jump-table arms and folds lui/ori immediates into wrong constants.
//
// Source (assembly): exe-decomp/cardgame.norm.s
//   F0x8009FDD8 mode-5/7 update @.L0x0001d128 (19-arm table D0x80083910)
//   F0x800A0B80 mode-6 update    @.L0x0001ded0 (6-arm table D0x80083978)
//   F0x800A0F94 mode-8 update    @.L0x0001e2e4 (27-arm table D0x80083990)
//
// WHAT A PLAYER SEES.
// - Battle Phase (5/7): the turn plays out. The two HUD half-panels slide in
//   and a banner names the phase; the player confirms; the machine hands the
//   turn to the effect VM (opcodes 0x98/0x99/0x9A/0x9D/0x9E) and to the AI,
//   growing and shrinking the per-side turn markers, staging each played card,
//   sorting the hand and waiting out the opponent's think window; the last arm
//   returns 1 once the turn is settled.
// - Mode 6: a short cleanup between phases — it asks the duel's own +0x818
//   method to repaint, re-sorts the AI hand, recomputes both sides' totals,
//   arms two more effect opcodes (0x9A/0x9D) and finally returns 1.
// - Set-End Phase (8): the result ceremony. It reveals the loser's board, rolls
//   the winner's set counter for a widget animation, raises the set/score
//   banners (ids 0x10..0x16), waits out each window and finally returns 2 when
//   the duel is decided or 1 to hand back to mode 9.
//
// Every view method and service it drives is a host edge. Most are already
// ported bodies wired by duel-session.ts; the few that are not (the effect
// opcodes this module only *arms*, the duel's +0x818 method, and the score
// widget constructor) stay explicit named gaps that throw TranslatedGapError on
// the unported builds — the session never substitutes a silent success.

export interface DuelBattleModeMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

/** Every edge the three updates drive. All are ported bodies or named gaps. */
export interface DuelBattleModeHost {
    // ---- board-view method slots -------------------------------------------
    /** view+0xEC8 = F0x8009C2D0 slideBothPanelsIn. */
    slidePanelsIn(view: number): void;
    /** view+0xEAC = F0x8009BEAC openInfoBanner(view, kind, a2, a3, w, h). */
    openInfoBanner(view: number, kind: number, a2: number, a3: number, w: number, h: number): void;
    /** view+0xEB0 = F0x8009BF5C writeBannerRecord(view, kind). */
    writeBannerRecord(view: number, kind: number): void;
    /** view+0xEE4 = F0x8009C054 openPrompt(view, a1, a2, a3, a4). */
    openPrompt(view: number, a1: number, a2: number, a3: number, a4: number): void;
    /** view+0xEE8 = F0x8009C0DC closePrompt(view). */
    closePrompt(view: number): void;
    /** view+0xEA0 = F0x8009CAE0 setHudCounter(view, side, index, value). */
    setHudCounter(view: number, side: number, index: number, value: number): void;
    /** view+0xED0 = F0x8009C4A4 growTurnMarker(view, side). */
    growTurnMarker(view: number, side: number): void;
    /** view+0xED4 = F0x8009C4D8 shrinkTurnMarker(view, side). */
    shrinkTurnMarker(view: number, side: number): void;
    // ---- shared services ----------------------------------------------------
    /** [0x80055C48]: the packed-sound dispatcher. */
    playPackedSound(id: number): void;
    /** [0x8004DF9C]() = resident F0x8001D704: the frame delta. */
    frameDelta(): number;
    /** pad block +0x3F4(0): the pressed word. */
    inputPortReset(): number;
    /** pad block +0x408(port, code): the logical button's bit index. */
    inputPortWord(port: number, code: number): number;
    // ---- mode 5/7 services --------------------------------------------------
    /** F0x8009D8FC(duel): sort the AI hand by priority. */
    sortAiHand(duel: number): void;
    /** F0x800A4978(duel, view): the opponent's card pick; non-zero = a pick. */
    aiChooseCard(duel: number, view: number): number;
    /** F0x8009F998(duel, scene): commit the selected hand card; returns its class+0x80. */
    commitSelectedHandCard(duel: number, scene: number): number;
    /** F0x8009FB18(duel, scene): light the legal field targets. */
    markLegalFieldTargets(duel: number, scene: number): void;
    /** F0x8009DEC4(duel, scene): the AI think-window wait; non-zero = over. */
    waitAiThinkWindow(duel: number, scene: number): number;
    /** `duel+0x814` = F0x8009EEFC: the hand selection sort. */
    handSelectionSort(a: number, b: number, packed: number, flags: number): void;
    // ---- mode 6 services ----------------------------------------------------
    /** `duel+0x818` = F0x800A0754(duel, arg): the duel's own repaint method. */
    duelMethod818(duel: number, arg: number): void;
    /** F0x800A09FC(duel): apply dynamic stat megas; returns the next sub-step. */
    applyDynamicStatMegas(duel: number): number;
    /** F0x800A0ACC(duel, side): recompute one side's totals. */
    recomputeSideTotals(duel: number, side: number): void;
    // ---- mode 8 services ----------------------------------------------------
    /** F0x800A0CD4(duel, side, cell): the set-window combo scan (-1 = keep waiting). */
    scanComboRuns(duel: number, side: number, cell: number): number;
    /** F0x800A367C(1): build the score widget; returns it. */
    createScoreWidget(): number;
    /** widget+0x68(widget, a1, a2, a3): the widget's configure method. */
    scoreWidgetConfigure(widget: number, a1: number, a2: number, a3: number): void;
    /** widget+0x6C(widget, a1, a2, a3, w, x): the widget's run method. */
    scoreWidgetRun(widget: number, a1: number, a2: number, a3: number, w: number, x: number): void;
}

// ---- the three dispatch tables (read from pro_cardgame.bin) ------------------

/** mode-5/7 (F0x8009FDD8) 19-word jump table at D0x80083910. */
export const BATTLE_57_TABLE = 0x80083910;
export const BATTLE_57_ARMS: readonly number[] = [
    0x8009fe30, 0x8009ffd0, 0x800a01b4, 0x800a0088, 0x800a0290, 0x800a0290,
    0x800a0308, 0x800a0308, 0x800a03e4, 0x800a03dc, 0x800a0400, 0x800a0424,
    0x800a0440, 0x800a0480, 0x800a048c, 0x800a04dc, 0x8009fe84, 0x8009fef8,
    0x8009ffac,
];
/** The state-advance byte table at 0x800A5D54: `table[k] = k + 2` for k 0..7. */
export const BATTLE_NEXT_TABLE_ADDR = 0x800a5d54;
export const BATTLE_NEXT_BYTES: readonly number[] = [2, 3, 4, 5, 6, 7, 8, 9];
/** mode-6 (F0x800A0B80) 6-word jump table at D0x80083978. */
export const BATTLE_MODE6_TABLE = 0x80083978;
export const BATTLE_MODE6_ARMS: readonly number[] = [
    0x800a0bd0, 0x800a0be8, 0x800a0c14, 0x800a0c38, 0x800a0c98, 0x800a0cb4,
];
/** mode-8 (F0x800A0F94) 27-word jump table at D0x80083990. */
export const BATTLE_MODE8_TABLE = 0x80083990;
export const BATTLE_MODE8_ARMS: readonly number[] = [
    0x800a0fec, 0x800a101c, 0x800a1048, 0x800a11a8, 0x800a11c4, 0x800a125c,
    0x800a1278, 0x800a1294, 0x800a1078, 0x800a10c8, 0x800a12ac, 0x800a12f8,
    0x800a151c, 0x800a155c, 0x800a161c, 0x800a166c, 0x800a1688, 0x800a171c,
    0x800a17e4, 0x800a1810, 0x800a182c, 0x800a18d8, 0x800a192c, 0x800a1948,
    0x800a19d4, 0x800a19c8, 0x800a19d0,
];

// ---- duel / view fields ------------------------------------------------------

/** mode-5/7's own duel fields. */
export const BATTLE57 = {
    /** the dispatched sub-state (u8) — the table index. */
    arm: 0x574,
    /** a counter the arms carry across states (s8). */
    counter: 0x575,
    /** a monotonic counter (u8). */
    step: 0x576,
    /** the "played this turn" flag (u8). */
    played: 0x577,
    /** the acting side latch (u8). */
    side: 0x578,
    /** the acting side (u8). */
    side2: 0x579,
    /** the effect-opcode return latch (s8); -1 means "not handed back yet". */
    latch: 0x57a,
    /** the wait timer the arms count down (s32). */
    timer: 0x57c,
    /** the mode-3 carry the first arm copies into both side latches (u8). */
    carry: 0x2f5,
    /** the current mode (u8). */
    mode: 0x2f8,
    /** the tick arm latch (u8). */
    tickArm: 0x2f4,
    /** the pending effect opcode (u8). */
    opcode: 0x421,
    /** the hand-selection-sort method pointer. */
    sortFn: 0x814,
    /** the field-clear gate the banner waits on (u8). */
    gate498: 0x498,
    /** the two rows' played counts (s16): side 0 / side 1. */
    row0Count: 0x5a6,
    row1Count: 0x66e,
    /** the staged per-played-card ids, stride 8. */
    staged: 0x580,
    /** the hand store the sort works on. */
    hand: 0x600,
} as const;

/** mode-6's own duel fields. */
export const BATTLE6 = {
    subStep: 0x2f9,
    opcode: 0x421,
    tickArm: 0x2f4,
    method818: 0x818,
    row0Count: 0x5a6,
    row1Count: 0x66e,
} as const;

/** mode-8's own duel fields. */
export const BATTLE8 = {
    subStep: 0x2f9,
    opcode: 0x421,
    tickArm: 0x2f4,
    /** the set timer/counter the widget arm accumulates (s32). */
    timer: 0x2fc,
    /** the current side / award byte (u8). */
    award: 0x301,
    /** the outcome byte (u8). */
    outcome: 0x302,
    /** the "extra banner" gate (u8). */
    gate304: 0x304,
    /** the extra-banner countdown (u8). */
    count305: 0x305,
    /** the two sides' set win counts (u8, stride 0xC8). */
    setCount: 0x5ae,
    /** the second side's set win count (u8). */
    setCount1: 0x676,
    /** the two rows' totals (s16). */
    row0Total: 0x59e,
    row1Total: 0x666,
    /** the two field rows' record counts (u8, stride 0x72). */
    rowCount: 0x72c,
    rowCount1: 0x79e,
    /** the prompt argument arm 21 hands the view (u32). */
    promptArg: 0x2ec,
    /** the widget-method clear the arms use (u32). */
    clear4e8: 0x4e8,
    /** the mode-5/7 panel gate the first arm waits on (u8). */
    gate498: 0x498,
} as const;

/** The scene's view pointer and the two view fields the mode-8 waits read. */
export const BATTLE_SCENE_VIEW = 0x18;
export const BATTLE_VIEW = {
    /** the HUD panel state the first arms wait on (s16). */
    panel: 0x64,
    /** the banner/prompt state byte. */
    bannerState: 0xe9b,
    /** the second wait state byte. */
    settleState: 0xdfa,
    /** the slide side indicator. */
    slideSide: 0x104,
    /** the score widget slot on the scene context. */
    sceneWidget: 0x4,
} as const;

const s8 = (v: number): number => (v << 24) >> 24;
const s16 = (v: number): number => (v << 16) >> 16;
const u16 = (v: number): number => v & 0xffff;

/** The pressed-bit test the whole duel uses on the shared input port. */
function padBit(host: DuelBattleModeHost, code: number): boolean {
    const reset = host.inputPortReset() | 0;
    const word = host.inputPortWord(0, code) | 0;
    return ((reset >>> (word & 0x1f)) & 1) !== 0;
}

/** The state-advance byte: `lbu [0x800A5D54 + index + off]`. */
function nextByte(index: number, off: number): number {
    const k = (index + off) & 0xff;
    return BATTLE_NEXT_BYTES[k & 7] as number;
}

// ===== mode 5/7 — the Battle Phase update (F0x8009FDD8) ======================

/**
 * F0x8009FDD8(duel, scene): the Battle Phase update. `duel+0x574` selects one of
 * 19 arms; a value of 19 or more falls through to arm 0's body (the original's
 * `beqz` sends out-of-range to 0x8009FE30). Arms 0, 16, 17 and 18 open the
 * ceremony (panels, banner, confirm, side latches); arm 1 fires the two HUD
 * readouts; arms 2, 4/5, 6/7 hand the turn to the effect VM (opcodes 0x98/0x99/
 * 0x93/0x92) and the AI and advance through the 0x800A5D54 next-state byte; arms
 * 8, 9 arm the deal/settle opcodes; arms 10-14 are the per-side staging and
 * flag flips; arm 15 shrinks both markers and returns 1 once the think window is
 * over. Read from exe-decomp/cardgame.norm.s .L0x0001d128.
 */
export function updateDuelModeFiveSeven(
    mem: DuelBattleModeMemory, host: DuelBattleModeHost, duel: number, scene: number,
): number {
    const view = mem.read32(scene + BATTLE_SCENE_VIEW) | 0;
    const index = readIndex(mem, duel);
    // an out-of-range index behaves exactly like arm 0
    switch (index > 18 ? 0 : index) {
        case 0: {
            const carry = mem.read8(duel + BATTLE57.carry) & 0xff;
            mem.write8(duel + BATTLE57.arm, 0x10);
            mem.write8(duel + BATTLE57.counter, 0);
            mem.write8(duel + BATTLE57.played, 0);
            mem.write16(duel + 0x582, 0);
            mem.write16(duel + 0x58a, 0);
            mem.write16(duel + 0x592, 0);
            mem.write8(duel + 0x49d, 1);
            mem.write8(duel + 0x499, 1);
            mem.write8(duel + BATTLE57.side2, carry);
            mem.write8(duel + BATTLE57.side, carry);
            host.slidePanelsIn(view);
            return 0;
        }
        case 1: {
            // the two-state side machine. The `li $v0,0x2` in the `beqz`'s delay
            // slot is what L348 compares against, so the v1>=2 && v1!=2 arm
            // stores 0xc — not the 0xc the branch's own delay slot suggests.
            const v1 = s8(mem.read8(duel + BATTLE57.counter));
            const flag = mem.read8(duel + BATTLE57.side) & 0xff;
            let next: number;
            if (v1 === 1) next = flag !== 0 ? 2 : 3;
            else if (v1 < 0) next = 0xc;
            else if (v1 === 0 || v1 === 2) next = flag !== 0 ? 3 : 2;
            else next = 0xc;
            mem.write8(duel + BATTLE57.arm, next);
            if ((mem.read8(duel + BATTLE57.counter) & 0xff) !== 0) mem.write8(duel + BATTLE57.played, 0);
            mem.write8(duel + BATTLE57.latch, 0xff);
            host.setHudCounter(view, 0, 6, s16(mem.read16(duel + BATTLE57.row0Count)));
            host.setHudCounter(view, 1, 6, s16(mem.read16(duel + BATTLE57.row1Count)));
            return 0;
        }
        case 2: {
            const latch = s8(mem.read8(duel + BATTLE57.latch));
            if (latch === -1) {
                mem.write8(duel + BATTLE57.tickArm, 1);
                mem.write8(duel + BATTLE57.opcode, 0x98);
                host.handSelectionSort(
                    duel, duel + BATTLE57.hand,
                    (s16(mem.read16(duel + BATTLE57.row0Count)) << 16) | 0, 0,
                );
                return 0;
            }
            if (latch === 0) {
                if (s8(mem.read8(duel + BATTLE57.counter)) !== 0) {
                    mem.write8(duel + BATTLE57.arm, 0xc);
                    return 0;
                }
                mem.write8(duel + BATTLE57.arm, 0xb);
                mem.write32(duel + BATTLE57.timer, 0x14);
                mem.write8(duel + BATTLE57.played, (mem.read8(duel + BATTLE57.played) + 1) & 0xff);
                host.playPackedSound(0x40019);
                host.growTurnMarker(view, 0);
                return 0;
            }
            const side = mem.read8(duel + BATTLE57.side2) & 0xff;
            mem.write8(duel + BATTLE57.latch, 0xff);
            mem.write8(duel + BATTLE57.arm, nextByte(side, 2));
            if ((mem.read8(duel + BATTLE57.played) & 0xff) === 0) return 0;
            mem.write8(view + BATTLE_VIEW.slideSide, 0);
            return 0;
        }
        case 3: return mode57ArmThree(mem, host, duel, scene, view);
        case 4:
        case 5: {
            const latch = s8(mem.read8(duel + BATTLE57.latch));
            if (latch === -1) {
                mem.write8(duel + BATTLE57.tickArm, 1);
                mem.write8(duel + BATTLE57.opcode, 0x99);
                return 0;
            }
            const side = mem.read8(duel + BATTLE57.side2) & 0xff;
            if (latch === 0) {
                mem.write8(duel + BATTLE57.latch, 0xff);
                mem.write8(duel + BATTLE57.arm, nextByte(side, 0));
                if ((mem.read8(duel + BATTLE57.played) & 0xff) !== 0) {
                    mem.write8(view + BATTLE_VIEW.slideSide, 2);
                }
                return 0;
            }
            mem.write8(duel + BATTLE57.latch, 0xff);
            mem.write8(duel + BATTLE57.arm, nextByte(side, 4));
            return 0;
        }
        case 6:
        case 7: return mode57ArmSix(mem, host, duel, scene, view);
        case 8: {
            mem.write8(duel + BATTLE57.opcode, 0x12);
            mem.write8(duel + BATTLE57.tickArm, 1);
            mem.write8(duel + BATTLE57.arm, 0xa);
            return 0;
        }
        case 9: {
            mem.write8(duel + BATTLE57.opcode, 0x13);
            mem.write8(duel + BATTLE57.tickArm, 1);
            mem.write8(duel + BATTLE57.arm, 0xa);
            return 0;
        }
        case 10: {
            mem.write8(duel + BATTLE57.arm, 1);
            mem.write8(duel + BATTLE57.side2, (mem.read8(duel + BATTLE57.side2) & 0xff) ^ 1);
            mem.write8(duel + BATTLE57.counter, (mem.read8(duel + BATTLE57.counter) + 1) & 0xff);
            return 0;
        }
        case 11: {
            let v = mem.read32(duel + BATTLE57.timer) | 0;
            v = (v - 1) | 0;
            mem.write32(duel + BATTLE57.timer, v >>> 0);
            if (v > 0) return 0;
            mem.write8(duel + BATTLE57.arm, 0xe);
            return 0;
        }
        case 12: {
            if (s8(mem.read8(duel + BATTLE57.counter)) <= 0) {
                mem.write8(duel + BATTLE57.arm, 0xe);
                return 0;
            }
            const c = mem.read8(duel + BATTLE57.counter) & 0xff;
            mem.write8(duel + BATTLE57.tickArm, 2);
            mem.write8(duel + BATTLE57.arm, 0xd);
            mem.write8(duel + 0x4dc, 0);
            mem.write32(duel + 0x4ec, 0);
            mem.write32(duel + 0x4e8, 0);
            mem.write8(duel + 0x4de, c);
            return 0;
        }
        case 13: {
            mem.write8(duel + BATTLE57.arm, 0xc);
            return 0;
        }
        case 14: {
            mem.write8(duel + BATTLE57.arm, 1);
            mem.write8(duel + BATTLE57.counter, 0);
            mem.write16(duel + 0x582, 0);
            mem.write16(duel + 0x58a, 0);
            mem.write16(duel + 0x592, 0);
            mem.write8(duel + BATTLE57.side, (mem.read8(duel + BATTLE57.side) & 0xff) ^ 1);
            mem.write8(duel + BATTLE57.side2, mem.read8(duel + BATTLE57.side) & 0xff);
            const step = (mem.read8(duel + BATTLE57.step) + 1) & 0xff;
            mem.write8(duel + BATTLE57.step, step);
            if ((mem.read8(duel + BATTLE57.played) & 0xff) < 2) return 0;
            mem.write8(duel + BATTLE57.arm, 0xf);
            mem.write32(duel + 0x4e8, 0);
            return 0;
        }
        case 15: {
            host.shrinkTurnMarker(view, 0);
            host.shrinkTurnMarker(view, 1);
            if ((host.waitAiThinkWindow(duel, scene) | 0) === 0) return 0;
            return 1;
        }
        case 16: {
            if (s16(mem.read16(view + BATTLE_VIEW.panel)) !== 2) return 0;
            if ((mem.read8(duel + BATTLE57.gate498) & 0xff) !== 0) return 0;
            mem.write8(duel + BATTLE57.arm, 0x11);
            const a3 = (mem.read8(duel + BATTLE57.mode) & 0xff) === 5 ? 0x3c : 0x3d;
            host.openInfoBanner(view, 5, 5, a3, 0, 0x6e);
            return 0;
        }
        case 17: {
            if ((mem.read8(view + BATTLE_VIEW.bannerState) & 0xff) !== 2) return 0;
            if (padBit(host, 0xd) || padBit(host, 0xe)) {
                mem.write8(duel + BATTLE57.arm, 0x12);
                host.writeBannerRecord(view, 5);
            }
            return 0;
        }
        default: { // case 18
            if ((mem.read8(view + BATTLE_VIEW.bannerState) & 0xff) !== 0) return 0;
            mem.write8(duel + BATTLE57.arm, 1);
            return 0;
        }
    }
}

function readIndex(mem: DuelBattleModeMemory, duel: number): number {
    return mem.read8(duel + BATTLE57.arm) & 0xff;
}

/** mode-5/7 arm 3 (0x800A0088): the AI turn / card commit. */
function mode57ArmThree(
    mem: DuelBattleModeMemory, host: DuelBattleModeHost, duel: number, scene: number, view: number,
): number {
    host.sortAiHand(duel);
    if ((host.aiChooseCard(duel, view) | 0) === 0) {
        if (s8(mem.read8(duel + BATTLE57.counter)) !== 0) {
            mem.write8(duel + BATTLE57.arm, 0xc);
            return 0;
        }
        mem.write8(duel + BATTLE57.arm, 0xb);
        const played = (mem.read8(duel + BATTLE57.played) + 1) & 0xff;
        mem.write32(duel + BATTLE57.timer, 0x14);
        mem.write8(duel + BATTLE57.played, played);
        host.playPackedSound(0x40019);
        host.growTurnMarker(view, 1);
        return 0;
    }
    const committed = host.commitSelectedHandCard(duel, scene) | 0;
    if (((committed - 0x83) >>> 0) < 2) {
        for (let d = 0; d <= 0xe; d++) mem.write8(duel + 0x46f + d, 0);
        const c = s8(mem.read8(duel + BATTLE57.counter));
        mem.write8(duel + c + 0x47a, 1);
        const idx = (s8(mem.read8(duel + BATTLE57.counter)) - 1) << 3;
        mem.write16(duel + idx + 0x582, 1);
    }
    if ((mem.read8(duel + BATTLE57.played) & 0xff) !== 0) {
        host.playPackedSound(0x40019);
        host.shrinkTurnMarker(view, 0);
    }
    mem.write8(duel + BATTLE57.arm, 9);
    host.markLegalFieldTargets(duel, view);
    return 0;
}

/** mode-5/7 arms 6/7 (0x800A0308): stage a played card from the acting side. */
function mode57ArmSix(
    mem: DuelBattleModeMemory, host: DuelBattleModeHost, duel: number, scene: number, view: number,
): number {
    const latch = s8(mem.read8(duel + BATTLE57.latch));
    if (latch === -1) {
        mem.write8(duel + BATTLE57.opcode, host.commitSelectedHandCard(duel, scene) & 0xff);
        mem.write8(duel + BATTLE57.tickArm, 1);
        return 0;
    }
    const side = mem.read8(duel + BATTLE57.side2) & 0xff;
    if (latch !== 0) {
        mem.write8(duel + BATTLE57.arm, nextByte(side, 6));
        return 0;
    }
    // stage duel[8*counter + 0x580] into row[side][count]
    const rowBase = duel + 0xc8 * side;
    const count = s16(mem.read16(rowBase + BATTLE57.row0Count));
    const src = u16(mem.read16(duel + 8 * s8(mem.read8(duel + BATTLE57.counter)) + BATTLE57.staged));
    mem.write16(rowBase + BATTLE57.hand + 2 * count, src);
    mem.write16(rowBase + BATTLE57.row0Count, (mem.read16(rowBase + BATTLE57.row0Count) + 1) & 0xffff);
    host.handSelectionSort(
        duel, duel + BATTLE57.hand,
        (s16(mem.read16(duel + BATTLE57.row0Count)) << 16) | 0, 0,
    );
    mem.write8(duel + BATTLE57.arm, nextByte(side, 2));
    mem.write8(duel + BATTLE57.latch, 0xff);
    return 0;
}

// ===== mode 6 — the short cleanup update (F0x800A0B80) ========================

/**
 * F0x800A0B80(duel, scene): the mode-6 update. `duel+0x2f9` (0..5) selects one of
 * six arms: arm 0 arms effect opcode 0x9A; arm 1 asks the duel's +0x818 method to
 * repaint with argument 0 and pushes the side-0 row readout; arm 2 re-sorts the
 * AI hand and arms opcode 0x9D; arm 3 repaints with argument 1, applies the
 * dynamic stat megas (whose result is the next sub-step), recomputes both sides'
 * totals and pushes the side-1 row readout; arm 4 arms opcode 0x9E; arm 5
 * returns 1 (the mode machine's advance). Read from
 * exe-decomp/cardgame.norm.s .L0x0001ded0.
 */
export function updateDuelModeSix(
    mem: DuelBattleModeMemory, host: DuelBattleModeHost, duel: number, scene: number,
): number {
    const view = mem.read32(scene + BATTLE_SCENE_VIEW) | 0;
    const sub = mem.read8(duel + BATTLE6.subStep) & 0xff;
    if (sub >= 6) return 0;
    switch (sub) {
        case 0: {
            mem.write8(duel + BATTLE6.opcode, 0x9a);
            mem.write8(duel + BATTLE6.tickArm, 1);
            mem.write8(duel + BATTLE6.subStep, 1);
            return 0;
        }
        case 1: {
            host.duelMethod818(duel, 0);
            mem.write8(duel + BATTLE6.subStep, 2);
            host.setHudCounter(view, 0, 6, s16(mem.read16(duel + BATTLE6.row0Count)));
            return 0;
        }
        case 2: {
            host.sortAiHand(duel);
            mem.write8(duel + BATTLE6.opcode, 0x9d);
            mem.write8(duel + BATTLE6.tickArm, 1);
            mem.write8(duel + BATTLE6.subStep, 3);
            return 0;
        }
        case 3: {
            host.duelMethod818(duel, 1);
            // The `li $v0,0x4` before the mega call is what the `jal`'s delay slot
            // stores into duel+0x2F9, so the sub-step is the literal 4 — the mega
            // call's own return is discarded (its result is not the next sub-step).
            mem.write8(duel + BATTLE6.subStep, 4);
            host.applyDynamicStatMegas(duel);
            host.recomputeSideTotals(duel, 1);
            host.recomputeSideTotals(duel, 0);
            host.setHudCounter(view, 1, 6, s16(mem.read16(duel + BATTLE6.row1Count)));
            return 0;
        }
        case 4: {
            mem.write8(duel + BATTLE6.opcode, 0x9e);
            mem.write8(duel + BATTLE6.tickArm, 1);
            mem.write8(duel + BATTLE6.subStep, 5);
            return 0;
        }
        default: return 1; // case 5
    }
}

// ===== mode 8 — the Set-End Phase update (F0x800A0F94) ========================

/**
 * F0x800A0F94(duel, scene): the Set-End Phase update. `duel+0x2f9` (0..26)
 * selects one of 27 arms; 27 or more returns 0. The arms reveal the board and
 * the banners (ids 0x10..0x16), roll the winner's set counter through the score
 * widget (arm 0x0B), settle the award byte, and finally arms 0x19/0x1A/0x1B
 * return 2 (decided), 1 (next) or 0. Read from
 * exe-decomp/cardgame.norm.s .L0x0001e2e4.
 */
export function updateDuelModeEight(
    mem: DuelBattleModeMemory, host: DuelBattleModeHost, duel: number, scene: number,
): number {
    const view = mem.read32(scene + BATTLE_SCENE_VIEW) | 0;
    const sub = mem.read8(duel + BATTLE8.subStep) & 0xff;
    if (sub >= 27) return 0;
    switch (sub) {
        case 0: {
            if (s16(mem.read16(view + BATTLE_VIEW.panel)) !== 2) return 0;
            if ((mem.read8(duel + BATTLE8.gate498) & 0xff) !== 0) return 0;
            mem.write8(duel + BATTLE8.subStep, 1);
            mem.write32(duel + BATTLE8.timer, 0);
            return 0;
        }
        case 1: {
            const ret = host.scanComboRuns(duel, 0, mem.read32(duel + BATTLE8.timer) | 0) | 0;
            if (ret === -1) {
                mem.write8(duel + BATTLE8.subStep, 2);
                mem.write32(duel + BATTLE8.timer, 0);
                return 0;
            }
            mem.write32(duel + BATTLE8.timer, ret >>> 0);
            mem.write8(duel + BATTLE8.opcode, 0x19);
            mem.write8(duel + BATTLE8.tickArm, 1);
            return 0;
        }
        case 2: {
            const ret = host.scanComboRuns(duel, 1, mem.read32(duel + BATTLE8.timer) | 0) | 0;
            // the `sw $v0,0x2fc` sits in the branch's delay slot, so the timer
            // always takes the return (including -1).
            mem.write32(duel + BATTLE8.timer, ret >>> 0);
            if (ret === -1) {
                mem.write8(duel + BATTLE8.subStep, 8);
                return 0;
            }
            mem.write8(duel + BATTLE8.opcode, 0x1a);
            mem.write8(duel + BATTLE8.tickArm, 1);
            return 0;
        }
        case 3: {
            if ((mem.read8(view + BATTLE_VIEW.bannerState) & 0xff) !== 2) return 0;
            mem.write8(duel + BATTLE8.subStep, 4);
            return 0;
        }
        case 4: {
            if (padBit(host, 0xd) || padBit(host, 0xe)) {
                mem.write8(duel + BATTLE8.subStep, 5);
                host.writeBannerRecord(view, 5);
            }
            return 0;
        }
        case 5: {
            if ((mem.read8(view + BATTLE_VIEW.bannerState) & 0xff) !== 0) return 0;
            mem.write8(duel + BATTLE8.subStep, 6);
            return 0;
        }
        case 6: {
            mem.write8(duel + BATTLE8.opcode, 0x15);
            mem.write8(duel + BATTLE8.tickArm, 1);
            mem.write8(duel + BATTLE8.subStep, 7);
            return 0;
        }
        case 7: {
            mem.write8(duel + BATTLE8.opcode, 0x16);
            mem.write8(duel + BATTLE8.tickArm, 1);
            mem.write8(duel + BATTLE8.subStep, 0xa);
            mem.write32(duel + BATTLE8.timer, 0);
            return 0;
        }
        case 8: {
            if ((mem.read8(duel + BATTLE8.gate304) & 0xff) !== 0) {
                mem.write8(duel + BATTLE8.opcode, 0x1b);
                mem.write8(duel + BATTLE8.tickArm, 1);
                mem.write8(duel + BATTLE8.count305, (mem.read8(duel + BATTLE8.count305) - 1) & 0xff);
            }
            mem.write8(duel + BATTLE8.subStep, (mem.read8(duel + BATTLE8.count305) & 0xff) !== 0 ? 8 : 9);
            return 0;
        }
        case 9: return mode8ArmNine(mem, host, duel, view);
        case 10: return mode8ArmTen(mem, duel);
        case 11: return mode8ArmEleven(mem, host, duel, scene, view);
        case 12: {
            const equal = s16(mem.read16(duel + BATTLE8.row0Total)) === s16(mem.read16(duel + BATTLE8.row1Total));
            const v = (equal ? mem.read8(view + BATTLE_VIEW.settleState)
                             : mem.read8(view + BATTLE_VIEW.bannerState)) & 0xff;
            if ((v ^ 2) !== 0) return 0;
            mem.write8(duel + BATTLE8.subStep, 0xd);
            return 0;
        }
        case 13: {
            if (padBit(host, 0xd) || padBit(host, 0xe)) {
                if (s16(mem.read16(duel + BATTLE8.row0Total)) === s16(mem.read16(duel + BATTLE8.row1Total))) {
                    host.closePrompt(view);
                } else {
                    host.writeBannerRecord(view, 5);
                }
                mem.write8(duel + BATTLE8.subStep, 0xe);
            }
            return 0;
        }
        case 14: {
            const equal = s16(mem.read16(duel + BATTLE8.row0Total)) === s16(mem.read16(duel + BATTLE8.row1Total));
            const v = (equal ? mem.read8(view + BATTLE_VIEW.settleState)
                             : mem.read8(view + BATTLE_VIEW.bannerState)) & 0xff;
            if (v !== 0) return 0;
            mem.write8(duel + BATTLE8.subStep, 0xf);
            host.openPrompt(view, 0x13, 0, 0, 1);
            return 0;
        }
        case 15: {
            if ((mem.read8(view + BATTLE_VIEW.settleState) & 0xff) !== 2) return 0;
            mem.write8(duel + BATTLE8.subStep, 0x10);
            return 0;
        }
        case 16: {
            if (padBit(host, 0xd) || padBit(host, 0xe)) {
                host.closePrompt(view);
                mem.write8(duel + BATTLE8.subStep, 0x11);
            }
            return 0;
        }
        case 17: return mode8ArmSeventeen(mem, host, duel, view);
        case 18: {
            const award = (mem.read8(duel + BATTLE8.award) & 0xff) !== 0 ? 0x1d : 0x1c;
            mem.write8(duel + BATTLE8.opcode, award);
            mem.write8(duel + BATTLE8.tickArm, 1);
            mem.write8(duel + BATTLE8.subStep, 0x1a);
            return 0;
        }
        case 19: {
            if ((mem.read8(view + BATTLE_VIEW.bannerState) & 0xff) !== 2) return 0;
            mem.write8(duel + BATTLE8.subStep, 0x14);
            return 0;
        }
        case 20: {
            if (padBit(host, 0xd) || padBit(host, 0xe)) {
                if ((mem.read8(duel + BATTLE8.award) & 0xff) !== 0) {
                    mem.write8(duel + BATTLE8.subStep, 0x19);
                } else {
                    host.writeBannerRecord(view, 5);
                    mem.write8(duel + BATTLE8.subStep, 0x15);
                    mem.write32(duel + BATTLE8.clear4e8, 0);
                }
            }
            return 0;
        }
        case 21: {
            if ((mem.read8(view + BATTLE_VIEW.bannerState) & 0xff) !== 0) return 0;
            if ((host.waitAiThinkWindow(duel, scene) | 0) === 0) return 0;
            mem.write8(duel + BATTLE8.subStep, 0x16);
            host.openPrompt(view, mem.read32(duel + BATTLE8.promptArg) | 0, 0, 0, 3);
            return 0;
        }
        case 22: {
            if ((mem.read8(view + BATTLE_VIEW.settleState) & 0xff) !== 2) return 0;
            mem.write8(duel + BATTLE8.subStep, 0x17);
            return 0;
        }
        case 23: {
            if (padBit(host, 0xd) || padBit(host, 0xe)) mem.write8(duel + BATTLE8.subStep, 0x19);
            return 0;
        }
        case 25: return 2;
        case 26: return 1;
        default: return 0; // case 24 = the bare epilogue
    }
}

/** mode-8 arm 9 (0x800A10C8): pick the losing side and reveal its row. */
function mode8ArmNine(mem: DuelBattleModeMemory, host: DuelBattleModeHost, duel: number, view: number): number {
    if ((mem.read8(duel + BATTLE8.rowCount) & 0xff) !== 0
        && (mem.read8(duel + BATTLE8.rowCount1) & 0xff) !== 0) {
        mem.write8(duel + BATTLE8.subStep, 3);
        host.openInfoBanner(view, 5, 5, 0xd, 0, 0x6e);
        return 0;
    }
    const v1 = s16(mem.read16(duel + BATTLE8.row0Total));
    const v0 = s16(mem.read16(duel + BATTLE8.row1Total));
    const side = v0 < v1 ? 0 : 1;
    mem.write8(duel + BATTLE8.award, side);
    mem.write8(duel + BATTLE8.subStep, 0xb);
    if ((mem.read8(duel + BATTLE8.rowCount + 0x72 * side) & 0xff) !== 0) return 0;
    if ((mem.read8(duel + BATTLE8.rowCount + 0x72 * (side ^ 1)) & 0xff) === 0) return 0;
    mem.write8(duel + BATTLE8.subStep, 0xa);
    mem.write32(duel + BATTLE8.timer, 0);
    return 0;
}

/** mode-8 arm 10 (0x800A12AC): arm the award opcode from the two totals. */
function mode8ArmTen(mem: DuelBattleModeMemory, duel: number): number {
    const v1 = s16(mem.read16(duel + BATTLE8.row0Total));
    const v0 = s16(mem.read16(duel + BATTLE8.row1Total));
    if (v0 < v1) {
        mem.write8(duel + BATTLE8.opcode, 0x18);
        mem.write8(duel + BATTLE8.award, 0);
    } else {
        mem.write8(duel + BATTLE8.opcode, 0x17);
        mem.write8(duel + BATTLE8.award, 1);
    }
    mem.write8(duel + BATTLE8.tickArm, 1);
    mem.write8(duel + BATTLE8.subStep, 0xb);
    mem.write32(duel + BATTLE8.timer, 0);
    return 0;
}

/** mode-8 arm 11 (0x800A12F8): the winner's set-counter roll and score widget. */
function mode8ArmEleven(
    mem: DuelBattleModeMemory, host: DuelBattleModeHost, duel: number, scene: number, view: number,
): number {
    const side = mem.read8(duel + BATTLE8.award) & 0xff;
    const widgetSlot = view + 0x54 * side + 0xa4;
    if ((mem.read32(duel + BATTLE8.timer) & 1) !== 0) {
        const src = duel + 0xc8 * side + BATTLE8.setCount;
        mem.write32(widgetSlot, ((mem.read8(src) + 1) >>> 0));
    } else {
        const src = duel + 0xc8 * side + BATTLE8.setCount;
        mem.write32(widgetSlot, mem.read8(src) >>> 0);
    }
    let timer = mem.read32(duel + BATTLE8.timer) | 0;
    if (timer === 0) {
        host.playPackedSound(0x9c0002);
        const widget = host.createScoreWidget() >>> 0;
        host.scoreWidgetConfigure(widget, 0x80, 0x80, 0x80);
        mem.write32(scene + BATTLE_VIEW.sceneWidget, widget);
        host.scoreWidgetRun(widget, 0, 0, 0, 10, 1);
    }
    timer = (timer + (host.frameDelta() | 0)) | 0;
    mem.write32(duel + BATTLE8.timer, timer >>> 0);
    if (timer < 0x33) return 0;
    const src = duel + 0xc8 * side + BATTLE8.setCount;
    mem.write32(view + 0x54 * side + 0xa4, ((mem.read8(src) + 1) >>> 0));
    mem.write8(src, (mem.read8(src) + 1) & 0xff);
    mem.write8(duel + BATTLE8.subStep, 0xc);
    if ((mem.read8(duel + BATTLE8.award) & 0xff) === 0) {
        host.openInfoBanner(view, 5, 5, 0x10, 0, 0x6e);
        return 0;
    }
    if (s16(mem.read16(duel + BATTLE8.row0Total)) === s16(mem.read16(duel + BATTLE8.row1Total))) {
        // a tied set opens the DRAW window (0x12), not the win window (0x11)
        host.openPrompt(view, 0x12, 0, 0, 1);
        return 0;
    }
    host.openInfoBanner(view, 5, 5, 0x11, 0, 0x6e);
    return 0;
}

/** mode-8 arm 17 (0x800A171C): the score banners. */
function mode8ArmSeventeen(mem: DuelBattleModeMemory, host: DuelBattleModeHost, duel: number, view: number): number {
    if ((mem.read8(view + BATTLE_VIEW.settleState) & 0xff) !== 0) return 0;
    if ((mem.read8(duel + BATTLE8.setCount) & 0xff) >= 2) {
        host.playPackedSound(0x6004001e);
        host.openInfoBanner(view, 5, 5, 0x15, 0, 0x6e);
        mem.write8(duel + BATTLE8.subStep, 0x13);
        mem.write8(duel + BATTLE8.outcome, 0);
        return 0;
    }
    if ((mem.read8(duel + BATTLE8.setCount1) & 0xff) >= 2) {
        host.openInfoBanner(view, 5, 5, 0x16, 0, 0x6e);
        mem.write8(duel + BATTLE8.subStep, 0x13);
        mem.write8(duel + BATTLE8.outcome, 1);
        return 0;
    }
    mem.write8(duel + BATTLE8.subStep, 0x12);
    return 0;
}
