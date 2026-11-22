// The per-frame code the translated screen adapters share: painting a session's frame,
// and the update loop of the screens whose session starts once their data has loaded.

import type { VramMap } from "../engine/native/vram.js";
import type { NativeCardPrim } from "../engine/native/runtime.js";
import type { FightReportSession } from "../engine/dw3/ui/fight-report-session.js";
import { drawNativeTextWidgets } from "./native-screen-text.js";
import { paintScreenDim } from "./screendim.js";
import type { NativeScreenRenderStats } from "./types/native-screen-render.js";
import type { EndscreenScreen, EndCardData } from "./types/endscreen-translated.js";
import type { FightReportScreen } from "./types/fightreport-translated.js";
import type { GymScreen } from "./types/gym-translated.js";
import type { LabScreen } from "./types/lab-translated.js";
import type { SaveScreen } from "./types/save-translated.js";
import * as uiC from "./ui-c/index.js";
import type { UiComposer } from "./ui-c/types.js";
type NativeDrawCalls = FightReportSession["draw"]["calls"];

type NativeTextWidgetList = Parameters<typeof drawNativeTextWidgets>[1];

export interface NativeScreenRenderer {
    stats: NativeScreenRenderStats;
    ready(): boolean;
    draw(
        ctx: CanvasRenderingContext2D,
        calls: NativeDrawCalls,
        vram: VramMap | null,
        cards: readonly NativeCardPrim[],
        contextMarkers: readonly number[],
    ): unknown;
}

interface NativeScreenDraw {
    calls: NativeDrawCalls;
    contextMarkers: readonly number[];
}

interface NativeScreenWidgets {
    textWidgets(): NativeTextWidgetList;
}

export interface NativeScreenSession {
    /** absent on sessions that never fade (the canvas dim stays at 0) */
    fadeLevel?: () => number;
    draw: NativeScreenDraw;
    widgets: NativeScreenWidgets;
}

export interface NativeUIScope {
    key: string;
    compose: UiComposer;
    enable?: boolean;
}

export interface PaintNativeSessionOptions {
    fade?: boolean;
    revealWindow?: boolean;
    /** drawNativeTextWidgets calls this on each widget (opts.skip); no caller passes one yet */
    skipWidget?: ((widget: NativeTextWidgetList[number]) => boolean) | null;
    ui?: NativeUIScope | null;
}

/** The part of a started session the update loop drives: one tick per displayed frame, and the end check. */
export interface NativeTickSession<K> {
    tick(keys: K, displayTick: number): void;
    finished(): boolean;
}

/** The part of a translated screen adapter the update loop reads and writes. */
export interface NativeUpdateScreen<S> {
    _open: boolean;
    _failed: boolean;
    _session: S | null;
    _pending?: boolean;
    _ticks: number;
    _clock: { advance(seconds: number): Array<{ tick: number }> } | null;
    _finish?: () => unknown;
}

/** What a screen hands updateNativeSession: when its data is in, how to start, the held keys, and what to do on a failure. */
export interface UpdateNativeSessionOptions<S extends NativeTickSession<Iterable<unknown>>> {
    ready: () => unknown;
    start: () => void;
    held: () => Iterable<unknown>;
    // a method, so a screen's own `fail(error: Error)` fits (the catch below hands it the thrown value)
    fail(error: unknown): void;
    onFrame?: ((session: S) => void) | null;
}

/**
 * Paint one frame of a translated session: its recorded draw calls, its text widgets and,
 * unless `fade` is false, its screen fade. The caller owns the canvas transform.
 *
 * `revealWindow` paints each text element's own visible window (its first index
 * and count — the pair that makes text page). Screens whose elements page — the
 * conversation box, the place card, the help menu and the registration wizard's
 * welcome message — must ask for it; a screen that draws the whole line instead
 * stops at the first pause control code and never advances a page.
 *
 * `ui` = { key, compose, enable } puts the screen in the look C capture scope (web/ui-c): the clips it claims and its text become DOM
 * parts, the rest is drawn as art. The disc's fade stays the canvas subtract; the DOM layer takes the same level as brightness.
 */
export function paintNativeSession(ctx: CanvasRenderingContext2D, renderer: NativeScreenRenderer, session: NativeScreenSession, { fade = true, revealWindow = false, skipWidget = null, ui = null }: PaintNativeSessionOptions = {}) {
    const body = () => {
        renderer.draw(ctx, session.draw.calls, null, [], session.draw.contextMarkers);
        drawNativeTextWidgets(ctx, session.widgets.textWidgets(), skipWidget ? { revealWindow, skip: skipWidget } : { revealWindow });
    };
    const level = fade ? session.fadeLevel() : 0;
    if (ui) uiC.scope(ui.key, ctx, { enable: ui.enable !== false, compose: ui.compose, dim: Math.min(1, level / 255) }, body);
    else body();
    if (level) paintScreenDim(ctx, level, 320, 240);
}

/**
 * One update of a screen adapter whose session starts once `ready()` holds: start it, then run
 * its frames with the held keys and finish the screen when the session ends. The delta each frame
 * carries is the game's shared frame clock's (`engine/systems/frame-clock.ts`), which
 * `MenuDisplayClock.advance` publishes once per displayed frame, so the session never takes one
 * as an argument. `onFrame` sees the session after every tick but before the end check, so a
 * screen that pays out part way through its own run (the fight report credits the BIT while its
 * "BIT gained" page is up) can mirror that into the walker's state on the very frame the original
 * pays it.
 */
export function updateNativeSession<S extends NativeTickSession<Iterable<unknown>>>(screen: NativeUpdateScreen<S>, dt: number, { ready, start, held, fail, onFrame = null }: UpdateNativeSessionOptions<S>) {
    if (!screen._open || screen._failed) return;
    if (!screen._session) {
        if (!ready()) return;
        try { start(); } catch (error) { fail(error); return; }
        screen._pending = false;
    }
    try {
        const keys = held();
        for (const frame of screen._clock.advance(dt)) {
            screen._session.tick(keys, frame.tick);
            screen._ticks++;
            if (onFrame) onFrame(screen._session);
            if (screen._session.finished()) { screen._finish(); return; }
        }
    } catch (error) {
        fail(error);
    }
}
