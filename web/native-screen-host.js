// Production native-screen host (Phase 6 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// One reusable host owns the whole lifecycle of a shipped screen overlay in
// ordinary play: preload, boot through engine/native with the mixed-mode bridge
// installed, per-frame ticks, pad state, rendering through the existing
// draw-intent/VRAM/text paths, screen-finish detection, teardown and
// diagnostics. Screen modules (web/shop-native.js, later the rest) supply only
// their state adapter; web/game.js consumes this host and does not duplicate it
// per screen.
//
// The original screen object lives in RAM as a root object with a lifecycle
// word at +0xC. The original main loop (F0x80018140) destroys an object whose
// lifecycle reached 3 and NULLs the parent's child slot; `objectLifecycle`
// turns that rule on in the runtime so a sub-screen closing returns control to
// its parent screen, and the root's own death means the player has left.

import {
    bootNativeScreen,
    loadNativeScreens,
    nativeScreenActive,
    nativeScreenEntry,
    nativeScreenFinished,
    nativeScreenList,
    nativeScreenPackNameForDir,
    nativeScreenRead,
    nativeScreenState,
    nativeScreenWrite,
    nativeTextWidgets,
    setNativeScreenPad,
    teardownNativeScreen,
    tickNativeScreen,
} from "./native-screen.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { drawNativeTextWidgets } from "./native-screen-text.js";
import { NativeVblankClock } from "./vendor/engine.js";

/** Screen packs are extracted at the console's 320x240; the game canvas is
 *  640x480 and the field draws through the same 2x factor (ZOOM). */
export const NATIVE_SCREEN_W = 320;
export const NATIVE_SCREEN_H = 240;

/** How many ticks a screen waits for its sheets before it starts anyway. Five
 *  seconds at 60 Hz; a sheet that has not landed by then is not coming. */
const MAX_PACK_WAIT = 300;


let preload = null;

/** Fetch and decode every shipped screen overlay + bank once. Idempotent. */
export function preloadNativeScreens() {
    if (!preload) {
        preload = loadNativeScreens().catch((e) => {
            preload = null; // a failed preload must be retryable
            throw e;
        });
    }
    return preload;
}

/** True once the overlay manifest is loaded and a screen can boot. */
export function nativeScreensReady() {
    return nativeScreenList().length > 0;
}

/**
 * Open one screen through the host.
 *
 *   const host = openNativeScreen("pro/stitshop", {
 *       rootCtor: 0x8008c118,          // overlay-relative or absolute
 *       playPackedSound: (id) => {},   // audio forwarding (optional)
 *       seed: ({ write }) => { ... },  // state adapter's RAM contract
 *       preBoot: ({ write }) => { ... }, // writes the constructor reads
 *   });
 *   host.setPad(mask); host.tick(dt); host.draw(ctx, viewW, viewH);
 *   if (host.finished()) host.teardown();
 *
 * `tick(dt)` is ONE browser frame's worth of elapsed time, and the host turns
 * that into the console's vertical blanks (PAL 50 Hz, each publishing its own
 * display delta) before it steps the overlay: the original counts blanks in
 * its own screen objects, so a host that stepped the overlay once per browser
 * frame ran every one of those counters at the monitor's rate instead of the
 * console's. The card screens' backdrop wall is the plain case — it came round
 * every 3.2 s at 60 Hz where the disc takes 3.84 s. The clock is
 * `NativeVblankClock` (engine/systems/native-vblank-clock.ts), the same blank
 * conversion the translated screens get through `MenuDisplayClock`.
 *
 * Returns null when the overlay data has not been preloaded yet: callers queue
 * and retry (a native screen is a test failure, never a silent fallback to a
 * hand-authored module).
 */
export function openNativeScreen(moduleId, opts = {}) {
    if (!nativeScreensReady()) return null;
    const entry = nativeScreenEntry(moduleId);
    if (!entry) return null;
    const rt = bootNativeScreen(moduleId, {}, {
        bridge: true,
        rootCtor: opts.rootCtor,
        objectLifecycle: true,
        playPackedSound: opts.playPackedSound,
        memcard: opts.memcard,
        preBoot: opts.preBoot,
        rootArgs: opts.rootArgs,
    });
    if (!rt) return null;
    const renderer = createNativeScreenRenderer(entry, nativeScreenPackNameForDir, {
        skipClip: opts.skipClip,
    });
    // Start every sheet the screen draws from NOW, not on its first paint: the
    // fetch is async and the walker's first frame lands long before a sheet has
    // arrived. Then hold the screen's own first frames until they all have —
    // the same contract the translated adapters keep (web/cntysel-native.js:110,
    // web/inn-translated.js:69). Without it the shop's greeting fade ran with
    // its backdrop and header plates refused: the root's draw routine
    // (pro/stitshop F0x8008b60c, stitshop.s:8798-8988) places clip 20 at :8979
    // and the four chrome plates at :8835/:8870/:8905/:8941 on its very first
    // picture, so the first frames painted short and the fade arrived already
    // grown.
    //
    // Bounded: a pack the build never extracted must not hang the screen, so
    // after MAX_PACK_WAIT ticks the screen runs anyway and the renderer counts
    // the clips it could not paint as before.
    renderer.ready();
    let packWait = 0;
    const blanks = new NativeVblankClock();
    const host = {
        module: moduleId,
        rt,
        renderer,
        _pad: 0,
        setPad(held) {
            host._pad = held >>> 0;
            setNativeScreenPad(host._pad);
        },
        /** Every pack this screen draws from has its sheet and its clip table. */
        ready() {
            return renderer.ready();
        },
        /** Frames the screen spent held back waiting for its sheets. */
        packWait() {
            return packWait;
        },
        /**
         * One browser frame. `seconds` is its elapsed time; without it the host
         * measures the real interval itself, which is the honest answer for a
         * screen driven by its own rAF loop rather than the game's update.
         */
        tick(seconds) {
            if (!renderer.ready() && packWait < MAX_PACK_WAIT) {
                packWait += 1;
                host._stepped = false;
                return false;
            }
            // One clock, two shapes of the same question: the game's update hands
            // over the elapsed time it already measured, and a screen with its own
            // rAF loop lets the clock measure the interval between its stamps. Both
            // produce PAL blanks at the console's rate.
            const due = typeof seconds === "number"
                ? blanks.advance(seconds)
                : blanks.advanceFromStamp(typeof performance !== "undefined" ? performance.now() : 0);
            host._stepped = due.length > 0;
            for (const delta of due) tickNativeScreen(undefined, delta);
            return nativeScreenFinished();
        },
        /** Did the last `tick()` run a vertical blank? A caller that pulses a
         *  button for one frame needs this: a browser frame is not always a
         *  frame of the screen. */
        stepped() {
            return host._stepped === true;
        },
        finished() {
            return nativeScreenFinished();
        },
        draw(ctx, viewW = NATIVE_SCREEN_W, viewH = NATIVE_SCREEN_H) {
            if (!host.rt || !renderer.ready()) return;
            const s = viewW / NATIVE_SCREEN_W;
            ctx.save();
            ctx.scale(s, s);
            host.renderer.draw(ctx, host.rt.drawCalls, host.rt.vram, host.rt.cardPrims, host.rt.ctxMarkers, host.rt.rawPrims);
            drawNativeTextWidgets(ctx, nativeTextWidgets());
            ctx.restore();
        },
        state() {
            return nativeScreenState();
        },
        read: nativeScreenRead,
        write: nativeScreenWrite,
        teardown() {
            // Only clear the driver when this host still owns it: a screen that
            // booted later (the battle command menu after the wfightmn loader)
            // must not be torn down by a stale adapter's close.
            if ((nativeScreenState()?.module ?? null) === host.module) teardownNativeScreen();
            host.rt = null;
            host.renderer = null;
        },
    };
    opts.seed?.({ read: nativeScreenRead, write: nativeScreenWrite, rt });
    return host;
}

export { nativeScreenActive };
