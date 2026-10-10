// The card duel's mode-2 (Draw Phase) update, F0x8009F110, translated from
// pro/cardgame.
//
// This is the draw pass the whole duel waits on. The mode machine reaches mode 2
// through the inter-phase banner (mode 1 -> mode 10 -> mode 2; the record at
// 0x800A5D5C index 1 carries opcode 0xA6 and next mode 2). Its dispatcher reads
// the sub-step at duel+0x2F9 and jumps through the 22-entry table at
// 0x80083890; the arms build the board's Draw-Phase presentation one sub-step at
// a time, calling the board view and its sibling widgets through the
// constructor-installed method slots §23/§24 named. Read from the overlay
// assembly at F0x8009F110 @ exe-decomp/cardgame.norm.s .L0x0001c460 (the
// dispatcher) and its 22 arm bodies .L0x0001c4c4 .. .L0x0001cc08 — NOT the m2c
// C, which merges the jump-table arms.
//
// The arms, in the order the sub-step walks them:
//   0  wait for the intro cue object (scene+0x0) to report state 1 for a page
//   1  open the info banner (view+0xEAC) and plant element panel 0
//   2  wait 11 frames                     3  plant element panel 1
//   4  wait 11 frames                     5  plant element panel 2
//   6  wait 11 frames                     7  plant the marker (scene+0x8)
//   8  wait 11 frames, reset the page counter
//   9  the input arm: move the marker through the three pages, confirm advances
//   10 wait 15 frames                    11 scale the marker out
//   12 wait 6 frames                     13 scale panel 0 out
//   14 wait 4 frames                     15 scale panel 1 out
//   16 wait 4 frames                     17 scale panel 2 out
//   18 wait 4 frames                     19 advance the banner record
//   20 wait 6 frames
//   21 fill the duel's card table (view+0xF44), scan the piles, repaint the
//      HUD counters and shuffle the pile — then report 1, which the mode machine
//      turns into the next phase
//
// Player-visible result: the Draw-Phase board assembles itself — three element
// panels slide in over eleven frames each, a marker appears and steps across
// them on the confirm button, then everything scales back out, and the board
// hands the duel its card table so the battle phases can deal.
//
// The two self-contained neighbours mode 3 and mode 4 are in
// engine/dw3/ui/duel-mode-updates.ts.

import {
    createElementPanel, elementPanelStartOneshot, elementPanelScaleOut,
    type ElementPanelHost, type ElementPanelMemory,
} from "./duel-element-panel.ts";
import {
    createMarkerSprite, markerSetPosition, markerStartOneshot, markerScaleOut,
    type MarkerFamilyHost, type MarkerMemory,
} from "./duel-marker-sprite.ts";
import { openInfoBanner, writeBannerRecord, type BannerFamilyHost, type BannerMemory } from "./duel-info-banner.ts";

export interface DrawPhaseMemory extends ElementPanelMemory, MarkerMemory, BannerMemory {
    read32(addr: number): number;
}

export interface DrawPhaseHost extends ElementPanelHost, MarkerFamilyHost, BannerFamilyHost {
    /** `[0x8004DF9C]` = resident F0x8001D704: the frame delta. */
    frameDelta(): number;
    /** `[0x8004BBC4]` = F0x80018854: the port's rising-edge word (u16). */
    padWord(port: number): number;
    /** `[0x8004BBCC]` = F0x8001889C: the port's held/repeat word (u16). */
    padRepeatWord(port: number): number;
    /** `[0x8004BBD8]` = F0x80018980: the logical button's bit index (u8). */
    padKeyBit(port: number, code: number): number;
    /** `view+0xF44` = F0x8009D15C build_duel_card_table. */
    buildCardTable(out: number, playerList: number, opponentList: number): number;
    /** F0x8009D9E4 scanDeckAvailability. */
    scanDeckAvailability(duel: number): void;
    /** F0x8009EDCC refreshAllCounters. */
    refreshAllCounters(duel: number, scene: number): void;
    /** `duel+0x810` = F0x8009F04C randomised pile shuffle (duel, offset, count). */
    pileShuffle(duel: number, a1: number, a2: number): void;
}

/** The duel / scene fields the dispatcher reads and writes. */
export const DRAW_PHASE = {
    /** past mode (u8), read by the banner queue */
    /** the sub-step the dispatcher switches on (u8) */
    subStep: 0x2f9,
    /** the frame-delta accumulator the timer arms sum (s32) */
    frameSum: 0x2fc,
    /** the marker's current page (s16) */
    page: 0x2ea,
    /** the card-table return the last arm stores (u8) */
    tableCount: 0x244,
    /** scene+0x0: the intro cue object the first arm waits on */
    intro: 0x00,
    /** scene+0x8: the marker widget */
    marker: 0x08,
    /** scene+0xC / +0x10 / +0x14: the three element panels */
    panel0: 0x0c,
    panel1: 0x10,
    panel2: 0x14,
    /** scene+0x18: the board view */
    view: 0x18,
} as const;

export const MODE_TWO_UPDATE = 0x8009f110;
export const MODE_TWO_ARMS = 22;
export const MODE_TWO_TABLE = 0x80083890;
export const MODE_TWO_ARM_ADDRS: readonly number[] = [
    0x8009f174, 0x8009f1bc, 0x8009f220, 0x8009f24c, 0x8009f284, 0x8009f2b0, 0x8009f2e8, 0x8009f314,
    0x8009f334, 0x8009f374, 0x8009f574, 0x8009f5a0, 0x8009f70c, 0x8009f5c0, 0x8009f5f8, 0x8009f624,
    0x8009f65c, 0x8009f688, 0x8009f6c0, 0x8009f6ec, 0x8009f70c, 0x8009f750,
];
/** The two-element position table the marker's x/y come from (lh pairs). */
export const DRAW_PHASE_POSITIONS = 0x800a5d48;
/** The sound ids the arms ask the packed-sound dispatcher for. */
export const DRAW_PHASE_SOUND_BANNER = 0x40019;
export const DRAW_PHASE_SOUND_PANEL = 0x4001a;
export const DRAW_PHASE_SOUND_PAGE_DOWN = 0x4001b;
export const DRAW_PHASE_SOUND_CONFIRM = 0x4001c;
/** High bit of the two page buttons; the confirm is logical 0xD. */
export const PAD_CODE_PAGE = 4;
export const PAD_CODE_PAGE_BACK = 6;
export const PAD_CODE_CONFIRM = 0xd;
export const PAD_PORT = 0;

const s32 = (v: number): number => v | 0;

/** `lbu`/`lh` of the shipped two-element position table (read through mem). */
function positionPair(mem: DrawPhaseMemory, index: number): [number, number] {
    const base = DRAW_PHASE_POSITIONS + index * 4;
    return [mem.read16s(base) | 0, mem.read16s(base + 2) | 0];
}

/** `(padWord | padRepeatWord)` bit `keymap[code]` for one logical button. */
function buttonDown(mem: DrawPhaseMemory, host: DrawPhaseHost, code: number, repeat: boolean): boolean {
    const word = ((host.padWord(PAD_PORT) | (repeat ? host.padRepeatWord(PAD_PORT) : 0)) >>> 0);
    const bit = host.padKeyBit(PAD_PORT, code) & 31;
    return ((word >>> bit) & 1) !== 0;
}

/**
 * F0x8009F110(duel, scene): one mode-2 (Draw Phase) frame. Returns 1 only from
 * the last arm (the card-table fill), which the mode machine turns into mode 10.
 */
export function updateDuelModeTwo(mem: DrawPhaseMemory, host: DrawPhaseHost, duel: number, scene: number): number {
    const sub = mem.read8(duel + DRAW_PHASE.subStep) & 0xff;
    const arm = sub < MODE_TWO_ARMS ? sub : 0;
    const view = mem.read32(scene + DRAW_PHASE.view) | 0;

    /** TAIL_D: bump the sub-step (no accumulator clear). */
    const advanceOnly = (): number => {
        const s = mem.read8(duel + DRAW_PHASE.subStep) & 0xff;
        mem.write8(duel + DRAW_PHASE.subStep, (s + 1) & 0xff);
        return 0;
    };
    /** TAIL_B/D: clear the accumulator, then bump the sub-step. */
    const advance = (): number => {
        const s = mem.read8(duel + DRAW_PHASE.subStep) & 0xff;
        mem.write32(duel + DRAW_PHASE.frameSum, 0);
        mem.write8(duel + DRAW_PHASE.subStep, (s + 1) & 0xff);
        return 0;
    };
    /** The timer arms: accumulate the frame delta; advance once `limit` is met. */
    const timer = (limit: number, after?: () => void): number => {
        const sum = ((mem.read32(duel + DRAW_PHASE.frameSum) | 0) + (host.frameDelta() | 0)) | 0;
        mem.write32(duel + DRAW_PHASE.frameSum, sum >>> 0);
        if (s32(sum) < limit) return 0;
        if (after) after();
        return advance();
    };

    switch (arm) {
        case 0: {
            const intro = mem.read32(scene + DRAW_PHASE.intro) | 0;
            if (intro !== 0 && ((mem.read32(intro + 0xc) | 0) !== 1 || (mem.read32(intro + 0x50) | 0) === 0)) {
                return 0;
            }
            return advanceOnly();
        }
        case 1: {
            const pair = positionPair(mem, 0);
            openInfoBanner(mem, host, view, 5, 5, 0x41, 0, 0x26);
            host.playSound(DRAW_PHASE_SOUND_BANNER);
            mem.write32(scene + DRAW_PHASE.panel0, createElementPanel(mem, host, 0, pair[0], pair[1]));
            return advance();
        }
        case 2: return timer(0xb);
        case 3: {
            const pair = positionPair(mem, 1);
            host.playSound(DRAW_PHASE_SOUND_BANNER);
            mem.write32(scene + DRAW_PHASE.panel1, createElementPanel(mem, host, 1, pair[0], pair[1]));
            return advance();
        }
        case 4: return timer(0xb);
        case 5: {
            const pair = positionPair(mem, 2);
            host.playSound(DRAW_PHASE_SOUND_BANNER);
            mem.write32(scene + DRAW_PHASE.panel2, createElementPanel(mem, host, 2, pair[0], pair[1]));
            return advance();
        }
        case 6: return timer(0xb);
        case 7: {
            const pair = positionPair(mem, 0);
            mem.write32(scene + DRAW_PHASE.marker, createMarkerSprite(mem, host, pair[0], pair[1]));
            return advance();
        }
        case 8: return timer(0xb, () => mem.write16(duel + DRAW_PHASE.page, 0));
        case 9: return armNine(mem, host, duel, scene, advance, advanceOnly);
        case 10: return timer(0xf);
        case 11: {
            markerScaleOut(mem, mem.read32(scene + DRAW_PHASE.marker) | 0);
            return advance();
        }
        case 12: return timer(6);
        case 13: {
            host.playSound(DRAW_PHASE_SOUND_PANEL);
            elementPanelScaleOut(mem, mem.read32(scene + DRAW_PHASE.panel0) | 0);
            return advance();
        }
        case 14: return timer(4);
        case 15: {
            host.playSound(DRAW_PHASE_SOUND_PANEL);
            elementPanelScaleOut(mem, mem.read32(scene + DRAW_PHASE.panel1) | 0);
            return advance();
        }
        case 16: return timer(4);
        case 17: {
            host.playSound(DRAW_PHASE_SOUND_PANEL);
            elementPanelScaleOut(mem, mem.read32(scene + DRAW_PHASE.panel2) | 0);
            return advance();
        }
        case 18: return timer(4);
        case 19: {
            writeBannerRecord(mem, host, view, 5);
            return advance();
        }
        case 20: return timer(6);
        default: return armTwentyOne(mem, host, duel, scene, advance);
    }

    /** Arm 9: the marker walk. `advance`/`advanceOnly` are captured tails. */
    function armNine(
        m: DrawPhaseMemory, h: DrawPhaseHost, d: number, s: number,
        adv: () => number, advOnly: () => number,
    ): number {
        // The page button pair: logical 4 (rising edge or repeat).
        if (buttonDown(m, h, PAD_CODE_PAGE, true)) {
            const page = m.read16s(d + DRAW_PHASE.page) | 0;
            if (page <= 0) return placeMarker(m, h, d, s);
            m.write16(d + DRAW_PHASE.page, (page - 1) & 0xffff);
            h.playSound(DRAW_PHASE_SOUND_PAGE_DOWN);
            return placeMarker(m, h, d, s);
        }
        // Logical 6: increment the page while below 2.
        if (buttonDown(m, h, PAD_CODE_PAGE_BACK, true)) {
            const page = m.read16s(d + DRAW_PHASE.page) | 0;
            if (page < 2) {
                m.write16(d + DRAW_PHASE.page, (page + 1) & 0xffff);
                h.playSound(DRAW_PHASE_SOUND_PAGE_DOWN);
            }
            return placeMarker(m, h, d, s);
        }
        // The confirm (logical 0xD, rising edge only): arm the panel and marker
        // for this page, clear the accumulator, advance the sub-step.
        if (buttonDown(m, h, PAD_CODE_CONFIRM, false)) {
            h.playSound(DRAW_PHASE_SOUND_CONFIRM);
            const page = m.read16s(d + DRAW_PHASE.page) | 0;
            const panel = m.read32(s + DRAW_PHASE.panel0 + page * 4) | 0;
            elementPanelStartOneshot(m, panel);
            markerStartOneshot(m, m.read32(s + DRAW_PHASE.marker) | 0);
            const tail = adv();
            void tail;
            return placeMarker(m, h, d, s);
        }
        return placeMarker(m, h, d, s);
    }

    /** The shared `.L0x0001C898` tail: place the marker at the page's spot. */
    function placeMarker(m: DrawPhaseMemory, _h: DrawPhaseHost, d: number, s: number): number {
        const page = m.read16s(d + DRAW_PHASE.page) | 0;
        const pair = positionPair(m, page);
        markerSetPosition(m, m.read32(s + DRAW_PHASE.marker) | 0, pair[0], pair[1]);
        return 0;
    }

    /** Arm 21: fill the card table, scan the piles, repaint the counters, shuffle. */
    function armTwentyOne(
        m: DrawPhaseMemory, h: DrawPhaseHost, d: number, s: number, adv: () => number,
    ): number {
        void adv;
        const page = m.read16s(d + DRAW_PHASE.page) | 0;
        const recordBase = (0x80048d34 + page * 0x66) | 0;
        if ((m.read16s(recordBase + 0x63e) | 0) !== 0) {
            for (let i = 0; i < 0x28; i++) {
                const v = m.read16s(recordBase + 0x63e + i * 2) | 0;
                m.write16(d + 0x298 + i * 2, (v - 1) & 0xffff);
            }
        } else {
            for (let i = 0; i < 0x28; i++) m.write16(d + 0x298 + i * 2, m.read16s(0x800a5c74 + i * 2) & 0xffff);
        }
        const count = h.buildCardTable(d + 0x50, d + 0x298, d + 0x248) | 0;
        m.write8(d + DRAW_PHASE.tableCount, count & 0xff);
        for (let i = 0; i < 0x28; i++) {
            m.write16(d + 0x5b0 + i * 2, i & 0xffff);
            m.write16(d + 0x678 + i * 2, (i + 0x28) & 0xffff);
        }
        h.scanDeckAvailability(d);
        m.write8(d + 0x300, 0);
        m.write16(d + 0x66c, 0x28);
        m.write16(d + 0x5a4, 0x28);
        m.write16(d + 0x668, 0);
        h.refreshAllCounters(d, s);
        m.write16(d + 0x5a0, 0);
        h.pileShuffle(d, m.read16s(d + 0x59c + 4) | 0, m.read16s(d + 0x59c + 8) | 0);
        return 1;
    }
}
