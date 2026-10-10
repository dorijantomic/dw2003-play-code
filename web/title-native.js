// The title screen as a production native screen (Phase 6.3 group 3 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// The player meets the shipped pro/stdwtitl overlay at boot: the DIGIMON logo
// and wordmark slide in, "Press Start Button" appears, and pressing Start splits
// the line into Start / Continue. This module is only the adapter between the
// walker's title flow in web/game.js and the screen's RAM contract; the screen
// itself runs through web/native-screen-host.js and engine/native.
//
// Contract (measured live 2026-09-22, scripts/title-menu-probe.mjs; the route
// inventory carries the addresses):
//   * "Press Start Button" waits for pad port 0 logical 3 = the START button
//     (bit 3, 0x08) in the menu tick F0x80085594 case 1 substate 2. Circle does
//     nothing there.
//   * The split menu takes Up/Down (logical 4/6) to move the box and Circle
//     (logical 0xD) to confirm; the sequence records the choice in its +0x58.
//   * title_choice_dispatch F0x80086834 launches through ctx+0x270C =
//     F0x80016B88, which writes ctx+0x26C8 (0x8004B3FC) = the launch kind and
//     ctx+0x26D0 (0x8004B404) = its argument. Measured: Start -> 0x2D7,
//     Continue -> 0xC00; the language-dependent 0xE01/0xE02 is the idle/attract
//     arm.
//   * The root's lifecycle reaches 3 after the fade, so nativeScreenFinished()
//     is this screen's close signal.
//
// The walker's own title (web/titlescreen.js, drawn from the extracted art)
// stays as the development rollback (?legacyTitle=1).

import { maskFromButtons } from "./vendor/engine.js";
import {
    openNativeScreen,
    preloadNativeScreens,
    nativeScreensReady,
} from "./native-screen-host.js";
import { nativeScreenObjects, nativeScreenRead } from "./native-screen.js";

const MODULE_ID = "pro/stdwtitl";
const ROOT_CB = 0x80086c70;
/** ctx+0x26C8: the launch kind F0x80016B88 writes (the same pair the other screens read). */
const LAUNCH_KIND = 0x80048d34 + 0x26c8;
const LAUNCH_ARG = 0x80048d34 + 0x26d0;

/** The launch kinds F0x80086834 requests. */
export const TITLE_LAUNCH_START = 0x2d7;
export const TITLE_LAUNCH_CONTINUE = 0xc00;

const PAD_START = 0x0008;   // logical 3
const PAD_UP = 0x0010;      // logical 4
const PAD_DOWN = 0x0040;    // logical 6
const PAD_CIRCLE = 0x2000;  // logical 0xD
/** A synthesised press is held this many frames so the screen's edge test sees it. */
const PRESS_FRAMES = 4;

export function createTitleNative(sfx = null) {
    const n = {
        _open: false,
        _pending: false,
        _host: null,
        _queue: [],
        _hold: 0,
        _mask: 0,
        _done: false,
        _result: 1,
        _started: false,
        _lastDiagnostic: null,
        _launchCode: 0,
        _launchArgument: 0,
    };

    function boot() {
        const host = openNativeScreen(MODULE_ID, {
            playPackedSound: (id) => { sfx?.playPacked(id); },
            seed: () => {},
        });
        if (!host) return false;
        n._host = host;
        return true;
    }

    /** Queue one synthesised pad press; the walker's title input is edge-based
     *  (up/down/confirm/start) while the screen samples the held word. */
    function press(mask) {
        n._queue.push(mask);
        return true;
    }

    n.open = () => {
        n._open = true;
        n._pending = false;
        n._done = false;
        n._result = 1;
        n._started = false;
        n._launchCode = 0;
        n._launchArgument = 0;
        n._queue.length = 0;
        n._hold = 0;
        n._mask = 0;
        preloadNativeScreens().catch((e) => {
            n._lastDiagnostic = `native screen preload failed: ${e?.message ?? e}`;
        });
        if (!boot()) n._pending = true;
        return n;
    };

    /**
     * The transition the screen's choice dispatcher wrote: F0x80086834 case 3
     * launches the idle/attract movie as 0xE01/0xE02 with argument 0, and
     * F0x80016B88 leaves the pair in ctx+0x26C8/+0x26D0 for the screen manager
     * to read. The shell asks the screen for it after the outcome, so it is
     * captured here before the host is torn down.
     */
    n.launchCode = () => n._launchCode;
    n.launchArgument = () => n._launchArgument;

    // The walker's title input API (web/game.js `titleInput` and the lab path).
    n.start = () => press(PAD_START);
    n.confirm = () => press(PAD_CIRCLE);
    n.up = () => press(PAD_UP);
    n.down = () => press(PAD_DOWN);
    /** Pointer selection: the screen has no pointer; translate a click on option
     *  `index` into the pad presses a player would make. */
    n.choose = (index) => {
        if (!n._started) {
            n.start();
            if (index > 0) n.down();
            n.confirm();
            return true;
        }
        if (index > 0) n.down();
        return n.confirm();
    };

    n.tick = () => {
        if (!n._open) return;
        if (n._pending) {
            if (!nativeScreensReady()) {
                preloadNativeScreens().catch(() => {});
                return;
            }
            if (!boot()) {
                n._lastDiagnostic = "native title boot failed (manifest/overlay missing)";
                return;
            }
            n._pending = false;
        }
        if (n._hold <= 0 && n._queue.length) {
            n._mask = n._queue.shift();
            n._hold = PRESS_FRAMES;
        }
        if (n._hold > 0) n._hold--;
        else n._mask = 0;
        if (n._mask === PAD_START) n._started = true;
        n._host.setPad(n._mask);
        if (n._host.tick() || titleClosed()) n._finish();
    };

    /** The screen's close: the root object's lifecycle reaches 3 after the fade. */
    function titleClosed() {
        const root = nativeScreenObjects().find((o) => (o.cb >>> 0) === ROOT_CB);
        if (!root) return true;
        return (nativeScreenRead(root.addr + 0xc, 4) | 0) === 3;
    }

    n.draw = (ctx, viewW, viewH) => {
        if (!n._open || !n._host) return false;
        n._host.draw(ctx, viewW, viewH);
        return true;
    };

    n.isDone = () => n._done;
    n.result = () => n._result;

    n._finish = () => {
        if (!n._open) return;
        n._open = false;
        const host = n._host;
        const kind = host ? host.read(LAUNCH_KIND, 4) >>> 0 : 0;
        n._launchCode = kind;
        n._launchArgument = host ? host.read(LAUNCH_ARG, 4) | 0 : 0;
        // The walker's three outcomes (web/titlescreen.js): Start launches the
        // game, Continue opens the memory-card LOAD screen, and the
        // language-dependent 0xE01/0xE02 arm is the idle/attract loop.
        if (kind === TITLE_LAUNCH_START) n._result = 1;          // RESULT_START
        else if (kind === TITLE_LAUNCH_CONTINUE) n._result = 2;  // RESULT_CONTINUE
        else if (kind === 0) n._result = 3;                      // closed without a launch: idle
        else n._result = 3;                                      // RESULT_IDLE
        n._done = true;
        host?.teardown();
        n._host = null;
    };

    n.close = () => {
        if (n._open) n._finish();
    };

    /** Diagnostics for the lab and focused browser checks. */
    n.diagnostics = () => ({
        open: n._open,
        pending: n._pending,
        done: n._done,
        result: n._result,
        started: n._started,
        launchCode: "0x" + n._launchCode.toString(16),
        launchArgument: n._launchArgument,
        launchKind: n._host ? "0x" + (n._host.read(LAUNCH_KIND, 4) >>> 0).toString(16) : null,
        host: n._host?.state() ?? null,
        lastDiagnostic: n._lastDiagnostic,
    });

    return n;
}
