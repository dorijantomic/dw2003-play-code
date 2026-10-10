// A headless host for the board view's per-frame handler (cardDuelViewTick,
// F0x8009BBA8) and the whole frame's presentation steps it runs.
//
// The board view is a task object the screen's DRAW PASS calls every frame; its
// tick builds the render bank once and then runs the frame's eight steps, the
// last of which (waitingSpinnerDraw, F0x80096950) is the only writer of
// view+0xE9E = 2 that the mode-1 update waits on. That makes this host the piece
// that lets a driver leave mode 1 without an interpreter.
//
// Every handler is a named boundary: the resident widget constructors, the
// resident sprite/pack draw context, the text measurer and the three
// still-untranslated per-state card bodies are inert here (the session has no
// canvas and no disc catalog), while the task-state advance is real — it bumps
// view+0xC, which is exactly what the resident F0x800142AC does and what moves
// the view from its setup arm to its frame arm.
//
// This adds no original-code claim. It is the draw-pass wiring the draw phase's
// own oracle records through recording stubs.

import type { DuelViewHost } from "./duel-view.ts";

export interface HeadlessViewHostMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface HeadlessViewHostOptions {
    /** `[0x8004DF9C]`: the frame delta. Default 0. */
    frameDelta?: () => number;
    /** Allocate `bytes` for a widget/scratch buffer. Default: a fixed scratch. */
    alloc?: (bytes: number) => number;
    /** The board view state word the task advance bumps (view+0xC). */
    stateOffset?: number;
}

/**
 * Build a `DuelViewHost` over `mem`. The draw calls go nowhere (there is no
 * canvas in a headless session) but every state write the frame steps make is
 * real, so the spinner, the message windows, the banners and the board draw all
 * advance their records exactly as the originals do.
 */
export function createHeadlessDuelViewHost(
    mem: HeadlessViewHostMemory, options: HeadlessViewHostOptions = {},
): DuelViewHost {
    const stateOffset = options.stateOffset ?? 0x0c;
    let scratchBase = 0x801ff000;
    const alloc = options.alloc ?? ((bytes: number) => {
        const at = scratchBase;
        scratchBase += (bytes + 15) & ~15;
        return at;
    });
    const frameDelta = options.frameDelta ?? (() => 0);
    const noop = (): void => {};
    return {
        // ── the sprite / draw context (inert: no canvas) ─────────────────────
        setOrigin: noop,
        setLayer: noop,
        setFrame: noop,
        setPos: noop,
        setScale: noop,
        drawSprite: noop,
        packResolve: () => 0,
        // ── resident service edges ───────────────────────────────────────────
        bankGet: () => 0,
        callService44F4C: () => 0,
        callSlot: () => 0,
        callSpriteStateBody: () => 0,
        callWidgetMethod: () => 0,
        measureText: () => 42,
        callViewClose: noop,
        callViewCloseFunction: noop,
        drawMessagePlate: noop,
        drawPileBadgePlate: noop,
        drawSelectionGlow: noop,
        drawEffectBadge: noop,
        drawFace: noop,
        scratch: (bytes: number) => alloc(bytes),
        frameDelta,
        // ── the three setup-arm edges (the task allocator + the widget factory)
        callViewHandler: (_fn: number, view: number) => {
            mem.write32(view + stateOffset, ((mem.read32(view + stateOffset) | 0) + 1) >>> 0);
        },
        spawnUiIcon: (_target: number, _order: number, _x: number, _y: number) => alloc(0x80) >>> 0,
        createTextElement: (_target: number, _fontKind: number, _x: number, _y: number) => alloc(0x80) >>> 0,
    };
}
