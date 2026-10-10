// The battle command menu as a production native screen (Phase 6.3 group 4 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// The player meets the shipped pro/fightstg command list — Fight / Tech / DV /
// Tag / Item / Run with the pgfgc00 chrome and the sliding highlight — while the
// walker's battle keeps owning the 3D scene and the HP plates.
//
// Contract, measured against the running overlay on 2026-09-22
// (.dw3-research/autonomous-plan/scripts/fightstg-menu-probe.mjs) and carried by
// lane B's translation engine/dw3/ui/native/fight-command-menu.ts:
//
//   * the manifest root constructor IS the command-menu actor constructor
//     F0x80093F9C(initialRow, outputCell): the actor's +0x50 takes initialRow and
//     +0x54 takes outputCell, which it stamps 0xffffffff.
//   * the tick F0x80093E44 state 0 builds the menu (config table 0x800A34CC, six
//     rows) and the six party-name widgets; state 1 waits for pad bit 0x2000
//     (confirm), writes *(outputCell) = the selected row 0..5, then SET_STATEs
//     the actor to 3 — which is exactly the host's finished() signal.
//   * Up/Down are pad bits 0x10/0x40 the menu ORs with the shared repeat word.
//
// Measured: two Down presses then confirm leaves 2 in the output cell, 0 traps.
// The adapter therefore only has to seed the row, feed the held pad, draw the
// overlay and hand the row back.
//
// The walker's own confused-menu gag (STATUS-C004) is a *different* six-row list
// the overlay's fixed config cannot express, so the battle keeps its own menu
// while b.confusedMenu is set; that is the one documented fallback and it is
// explicit, not a silent trap recovery.

import { maskFromButtons } from "./vendor/engine.js";
import {
    openNativeScreen,
    preloadNativeScreens,
    nativeScreensReady,
} from "./native-screen-host.js";
import { nativeScreenObjects, nativeScreenRead, nativeScreenWrite } from "./native-screen.js";

const MODULE_ID = "pro/fightstg";
/** Button -> pad bit, the same identity map the pad service publishes. */
const PAD_BIT = { up: 0x10, right: 0x20, down: 0x40, left: 0x80, triangle: 0x1000, circle: 0x2000, cross: 0x4000, square: 0x8000, start: 0x0008, select: 0x0001 };
/** The command-menu actor tick; the boot object list's first entry. */
export const COMMAND_ACTOR_CB = 0x80093e44;
export const COMMAND_ROWS = 6;

export function createBattleCommandNative(sfx = null) {
    const r = {
        _open: false,
        _pending: false,
        _host: null,
        _cell: 0,
        _row: 0,
        _pulse: 0,
        _releaseFrames: 0,
        _queue: [],
        _lastTraps: 0,
        _pendingFrames: 0,
        _presses: 0,
        _failed: false,
        _chosen: null,
        _lastDiagnostic: null,
    };

    /** True once the actor is in its input state (+0xC == 1, after the build). */
    function menuReady() {
        const actor = nativeScreenObjects().find((o) => (o.cb >>> 0) === COMMAND_ACTOR_CB);
        return !!actor && ((nativeScreenRead(actor.addr + 0x0c, 4) | 0) === 1);
    }

    /** Point the actor's output slot at the cell we allocated for it. */
    function bindOutputCell() {
        const actor = nativeScreenObjects().find((o) => (o.cb >>> 0) === COMMAND_ACTOR_CB);
        if (!actor) return false;
        r._cell = r._host.rt?.services?.alloc?.(8, 4) ?? 0;
        if (!r._cell) return false;
        nativeScreenWrite(actor.addr + 0x54, r._cell >>> 0, 4);
        nativeScreenWrite(r._cell, 0xffffffff, 4);
        return true;
    }

    function boot() {
        const host = openNativeScreen(MODULE_ID, {
            // The root ctor needs its real arguments; the cell is allocated after
            // boot (the constructor stamps whatever it is given, so 0 is safe).
            rootArgs: [r._row & 0xffff, 0],
            playPackedSound: (id) => {
                // The menu's own move blip. The confirm sound (0x4001C) is played
                // by the walker's confirm path once the row is handed back, so it
                // is not forwarded twice.
                if ((id >>> 0) === 0x0004001b) sfx?.playPacked(id);
            },
        });
        if (!host) return false;
        r._host = host;
        if (!bindOutputCell()) {
            r._lastDiagnostic = "command menu actor not found in the boot object list";
            host.teardown();
            r._host = null;
            return false;
        }
        return true;
    }

    /** Open the menu at `initialRow` (the battle's current selection). */
    r.open = (initialRow = 0) => {
        r._open = true;
        r._row = Number(initialRow) | 0;
        r._chosen = null;
        r._lastDiagnostic = null;
        preloadNativeScreens().catch((e) => {
            r._lastDiagnostic = `native screen preload failed: ${e?.message ?? e}`;
        });
        if (!boot()) r._pending = true;
    };

    r.isOpen = () => r._open && !r._failed;
    r.isPending = () => r._pending;
    /** True once the overlay is booted and owns the list (not while preloading). */
    r.active = () => r._open && !!r._host;
    /** True when the overlay never loaded and the walker's own list took over. */
    r.failed = () => r._failed;

    /**
     * Start fetching the overlay before the menu is needed. The battle calls this
     * when it starts, so the intro's 1.2s covers the one-time manifest load and
     * the list is up on the player's first command frame.
     */
    r.preload = () => {
        preloadNativeScreens().catch((e) => {
            r._lastDiagnostic = `native screen preload failed: ${e?.message ?? e}`;
        });
    };

    /**
     * A single key event as a short pad pulse. The game's held-button set is the
     * normal source, but a caller (or a headless verifier) may only dispatch a
     * keydown+keyup in one task; the menu reads the pad on the tick, so the pulse
     * keeps that press visible for a couple of frames.
     */
    r.press = (button) => {
        const bit = PAD_BIT[button] ?? 0;
        if (!bit) return;
        r._presses++;
        // Queue the edge: a press made before the overlay is reading the pad waits
        // for it, and each press becomes its own pad edge (the menu moves on the
        // pressed word, so two presses must not merge into one held stretch).
        r._queue.push(bit);
        if (r._queue.length > 16) r._queue.shift();
    };
    /** The confirmed row, once the player has pressed confirm. */
    r.chosen = () => r._chosen;

    /**
     * One frame. Returns the chosen row (0..5) on the frame the player confirms,
     * else null. `keys` is the walked game's held-button set.
     */
    r.update = (keys) => {
        if (!r._open) return null;
        if (r._pending) {
            if (!nativeScreensReady()) {
                preloadNativeScreens().catch(() => {});
                // A manifest that never arrives must not wedge the battle: after
                // ~10s the walker's own list takes over, with a diagnostic.
                if (++r._pendingFrames > 600) {
                    r._failed = true;
                    r._pending = false;
                    r._lastDiagnostic = "native command menu never loaded; battle kept its own list";
                }
                return null;
            }
            if (!boot()) {
                r._lastDiagnostic = "battle command menu boot failed (manifest/overlay missing)";
                return null;
            }
            r._pending = false;
        }
        const held = keys ? maskFromButtons(keys) : 0;
        // The actor's first tick builds the list and would swallow a press, so a
        // queued press is only spent once the actor reads the pad; one frame of
        // press (its edge) then one frame released, so the next press re-edges.
        // The host steps the overlay on the console's vertical blanks rather
        // than once per browser frame, so the edge is held until a blank has
        // actually read it — otherwise a 120 Hz display would drop every third
        // press on the floor.
        let pad = held;
        const ready = menuReady();
        if (r._pulse > 0) {
            pad |= r._pulse;
        } else if (r._releaseFrames > 0) {
            r._releaseFrames--;
        } else if (ready && r._queue.length > 0) {
            r._pulse = r._queue.shift() ?? 0;
            pad |= r._pulse;
        }
        r._host.setPad(pad >>> 0);
        const done = r._host.tick();
        if (r._pulse > 0 && r._host.stepped()) {
            r._releaseFrames = 1;
            r._pulse = 0;
        }
        r._lastTraps = r._host.state()?.traps ?? r._lastTraps;
        if (!done) return null;
        const row = nativeScreenRead(r._cell, 4) >>> 0;
        r._chosen = row;
        return row;
    };

    r.draw = (ctx, viewW = 320, viewH = 240) => {
        if (!r._open || !r._host) return;
        r._host.draw(ctx, viewW, viewH);
    };

    r.close = () => {
        if (!r._open) return;
        r._open = false;
        r._pending = false;
        const host = r._host;
        if (host) r._lastTraps = host.state()?.traps ?? r._lastTraps;
        r._host = null;
        host?.teardown();
    };

    /** Diagnostics for the lab and focused browser checks. */
    r.diagnostics = () => ({
        open: r._open,
        pending: r._pending,
        row: r._row,
        pulse: r._pulse,
        queued: r._queue.length,
        pendingFrames: r._pendingFrames,
        presses: r._presses,
        failed: r._failed,
        chosen: r._chosen,
        cell: r._cell,
        host: r._host?.state() ?? null,
        traps: r._host?.state()?.traps ?? r._lastTraps,
        lastDiagnostic: r._lastDiagnostic,
    });

    return r;
}
