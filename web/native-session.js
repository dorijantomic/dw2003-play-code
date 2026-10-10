// The per-frame code the translated screen adapters share: painting a session's frame,
// and the update loop of the screens whose session starts once their data has loaded.

import { drawNativeTextWidgets } from "./native-screen-text.js";
import { paintScreenDim } from "./screendim.js";

/**
 * Paint one frame of a translated session: its recorded draw calls, its text widgets and,
 * unless `fade` is false, its screen fade. The caller owns the canvas transform.
 *
 * `revealWindow` paints each text element's own visible window (its first index
 * and count — the pair that makes text page). Screens whose elements page — the
 * conversation box, the place card, the help menu and the registration wizard's
 * welcome message — must ask for it; a screen that draws the whole line instead
 * stops at the first pause control code and never advances a page.
 */
export function paintNativeSession(ctx, renderer, session, { fade = true, revealWindow = false } = {}) {
    renderer.draw(ctx, session.draw.calls, null, [], session.draw.contextMarkers);
    drawNativeTextWidgets(ctx, session.widgets.textWidgets(), { revealWindow });
    if (!fade) return;
    const level = session.fadeLevel();
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
export function updateNativeSession(screen, dt, { ready, start, held, fail, onFrame = null }) {
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
