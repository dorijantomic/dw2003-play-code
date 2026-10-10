// The card duel's board view: the per-frame handler and the board draw that
// ends it, translated from pro/cardgame:
//   F0x8009BBA8 cardDuelViewTick — build the text/plate bank, then run the
//                                  frame's eight presentation steps
//   F0x80099F60 boardViewDraw     — the marker + panel + HUD layer on top
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/duel-view-oracle.test.js runs both originals through
// engine/native on the shipped pro_cardgame.bin + resident.bin with the
// resident constructors, the view handler and the draw context recorded.
//
// DECODED: authority-2 closures `_asm/F0x8009bba8.s` (335 instructions) and
// `_asm/F0x80099f60.s`, the m2c bodies
// `exe-decomp/cardgame_c/F0x8009bba8.c` / `F0x80099f60.c`, and the accepted
// contract `cardgame-duel-view-contract`.
//
// Player-visible result: tick 1 builds the duel's 1 plate + 13 text widgets and
// hides the plate; every later tick runs, in order, the floating numbers, the
// two message windows, the six slot banners, all forty card sprites, the three
// played-slot plates, the scrolling backdrop, and last the board over the top
// of everything (two marker fades, both HUD strips' slide positions, both card
// rows).

import {
    type PlayerHudHost, type PlayerHudMemory, drawPlayerCardRow, slidePlayerPanel,
} from "./player-hud.ts";
import { type TurnMarkerHost, type TurnMarkerMemory, turnMarkerFadeTick } from "./turn-marker.ts";
import { type FloatNumberHost, type FloatNumberMemory, floatNumbersTickAll } from "./float-numbers.ts";
import { type CardSpriteHost, type CardSpriteMemory, cardSpritesTickAll } from "./card-sprites.ts";
import { type PileBadgeHost, type PileBadgeMemory, pileCountBadgesPopAll } from "./pile-badges.ts";
import { type BannerHost, hudSlotTextTickAll } from "./hud-banners.ts";
import { type MessageBoxBHost, messageBoxTickB } from "./message-box-b.ts";
import { type MessageBoxHost, messageBoxTick } from "./message-box.ts";
import { type CardDrawHost, waitingSpinnerDraw } from "./cardgame-draw.ts";

/** The one memory surface every step of the frame reads. */
export interface DuelViewMemory extends PlayerHudMemory, TurnMarkerMemory, FloatNumberMemory,
    CardSpriteMemory, PileBadgeMemory {
}

/**
 * The one host every step of the frame uses. The browser wires it to the
 * translated widgets, the resident services and the canvas; the oracle wires it
 * to recording stubs.
 */
export interface DuelViewHost extends PlayerHudHost, TurnMarkerHost, FloatNumberHost,
    CardSpriteHost, PileBadgeHost, BannerHost, MessageBoxBHost, MessageBoxHost {
    /** `view+0x38`(view): the task object's advance-phase method (F0x800142AC). */
    callViewHandler(fn: number, view: number): void;
    /** F0x8001B364(target, order, x, y): build and return the class-B plate. */
    spawnUiIcon(target: number, order: number, x: number, y: number): number;
    /** F0x8001AE38(target, fontKind, x, y): build and return a text widget. */
    createTextElement(target: number, fontKind: number, x: number, y: number): number;
}

/** The view's fields this handler touches. */
export const DUEL_VIEW = {
    state: 0x0c,
    handler: 0x38,
    busy: 0x54,
    frameSum: 0x58,
    panel0: 0x60,
    marker0: 0xa8,
    panel1: 0xb4,
    marker1: 0xfc,
} as const;

/** The 0x38-byte render bank: 1 plate then 13 text widgets. */
export const DUEL_RENDER_BANK = {
    plate: 0x00,
    widgets: 0x04,
    widgetCount: 13,
    size: 0x38,
} as const;

export const DUEL_WIDGET_KIND = 0x100;
/** F0x8001B04C: the plate's show/hide method (cursor +0x80). */
export const DUEL_PLATE_VISIBLE = 0x80;
/** F0x8001A450 (set_unk_0xbf): the widget's +0x160 method. */
export const DUEL_WIDGET_LINES = 0x160;
/** The four widgets whose +0x160 is called, in slot order, with its argument. */
export const DUEL_LINES_CALLS = [
    { slot: 0x1c, lines: 3 },
    { slot: 0x2c, lines: 3 },
    { slot: 0x30, lines: 5 },
    { slot: 0x34, lines: 2 },
] as const;
export const DUEL_STATE_FRAME = 1;
export const DUEL_STATE_DONE = 3;

/**
 * F0x80099F60(view, renderCtx): the last call of the frame. Runs the two turn
 * markers, then both panels' slides, then both HUD rows — side 0 before side 1
 * in each pair. It draws nothing itself.
 */
export function boardViewDraw(
    mem: DuelViewMemory, view: number, renderCtx: number, host: DuelViewHost,
): void {
    turnMarkerFadeTick(mem, view, renderCtx, 0, view + DUEL_VIEW.marker0, host);
    turnMarkerFadeTick(mem, view, renderCtx, 1, view + DUEL_VIEW.marker1, host);
    slidePlayerPanel(mem, view + DUEL_VIEW.panel0, 0, host);
    slidePlayerPanel(mem, view + DUEL_VIEW.panel1, 1, host);
    drawPlayerCardRow(mem, view + DUEL_VIEW.panel0, 0, host);
    drawPlayerCardRow(mem, view + DUEL_VIEW.panel1, 1, host);
}

/**
 * F0x8009BBA8(view, renderCtx): the board view's per-frame handler.
 * State 1 runs the eight-step frame arm, state 3 returns, and every other
 * value runs the one-shot setup arm that builds the render bank.
 */
export function cardDuelViewTick(
    mem: DuelViewMemory, view: number, renderCtx: number, host: DuelViewHost,
): void {
    const state = mem.read32(view + DUEL_VIEW.state) | 0;
    if (state === DUEL_STATE_FRAME) {
        const delta = host.frameDelta() | 0;
        mem.write32(view + DUEL_VIEW.busy, 0);
        mem.write32(view + DUEL_VIEW.frameSum, ((mem.read32(view + DUEL_VIEW.frameSum) | 0) + delta) >>> 0);
        floatNumbersTickAll(mem, view, host);
        messageBoxTickB(mem, view, renderCtx, host);
        messageBoxTick(mem, view, renderCtx, host);
        hudSlotTextTickAll(mem, view, renderCtx, host);
        cardSpritesTickAll(mem, view, host);
        pileCountBadgesPopAll(mem, view, renderCtx, host);
        waitingSpinnerDraw(mem, view, host);
        boardViewDraw(mem, view, renderCtx, host);
        return;
    }
    if (state === DUEL_STATE_DONE) return;

    host.callViewHandler(mem.read32(view + DUEL_VIEW.handler) >>> 0, view);
    const plate = host.spawnUiIcon(DUEL_WIDGET_KIND, 0, 0, 0) >>> 0;
    mem.write32(renderCtx + DUEL_RENDER_BANK.plate, plate);
    host.callWidgetMethod(plate, DUEL_PLATE_VISIBLE, 0, 0);
    const lines = new Map<number, number>(DUEL_LINES_CALLS.map((c) => [c.slot, c.lines]));
    for (let i = 0; i < DUEL_RENDER_BANK.widgetCount; i++) {
        const widget = host.createTextElement(DUEL_WIDGET_KIND, 1, 0, 0) >>> 0;
        mem.write32(renderCtx + DUEL_RENDER_BANK.widgets + i * 4, widget);
        const need = lines.get(DUEL_RENDER_BANK.widgets + i * 4);
        if (need !== undefined) host.callWidgetMethod(widget, DUEL_WIDGET_LINES, need, 0);
    }
}
