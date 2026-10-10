// The battle controller overlay's boot pipeline (pro/wfightmn) as a production
// step of every battle (Phase 6.3 group 4 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// What this overlay IS, measured rather than assumed:
//
//   * Its manifest root ctor `F0x800A6414` allocates the 0x54-byte loader object
//     whose tick is `F0x800A5ECC` — the battle SETUP/asset machine (state at
//     `+0x14`, 0..6; phase map: `docs/research/battle/wfightmn-overlay-map.md`
//     §"The 7-state machine"). The tick requests the battle's scene banks
//     (0x456, 0x79E, 0x7AE, 0x7E1, 0x7E3), waits for each through the cache
//     service `[0x80044B38+0x404]`, builds the matching asset objects, deactivates
//     them, then requests the eight text banks (`*(0x8005CCA8)+0x{7F,4E,A2,9B,6A,
//     63}` plus 0x286/0x455) and finally `SET_STATE(self, 3)` — it destroys itself
//     when they are all ready.
//   * The turn loop is a *different* machine in the same file (#2), and its
//     action semantics live in a vtable built outside the file
//     (`ctx+0x28/+0x2C/+0x40` are never stored in `wfightmn.s`). The walker's own
//     battle keeps owning the turn loop, the 3D scene and the HUD; this adapter
//     runs only the original boot pipeline, and the division is recorded in the
//     route inventory and the Phase 6 final report.
//
// Measured in the lab (`.dw3-research/autonomous-plan/scripts/
// wfightmn-loader-probe.mjs`): the loader boots, runs its whole pipeline, asks
// for its banks and retires with 0 traps and 0 draw intents (it is a data
// overlay); the runtime's cache service settles its requests.
//
// There is no player-visible surface here, so there is no capture: the proof is
// the bank requests being served and the clean retirement, asserted by
// tools/verify_native_wfightmn.mjs.

import {
    openNativeScreen,
    preloadNativeScreens,
    nativeScreensReady,
} from "./native-screen-host.js";
import { nativeScreenObjects, nativeScreenState } from "./native-screen.js";

const MODULE_ID = "pro/wfightmn";
/** The loader object's tick — the manifest root's callback. */
export const WFIGHT_LOADER_CB = 0x800a5ecc;
/** The manifest root constructor (F0x800A6414). */
export const WFIGHT_ROOT_CTOR = 0x800a6414;
/** The cache service's 0x40-slot table: state +0, id +4, last touch +8, buffer +0xC. */
export const CACHE_SLOTS = 0x80044b3c;
export const CACHE_SLOT_COUNT = 0x40;

export function createWfightNative() {
    const w = {
        _open: false,
        _pending: false,
        _host: null,
        _done: false,
        _framesAlive: 0,
        _bankIds: [],
        _lastTraps: 0,
        _lastDiagnostic: null,
    };

    function boot() {
        const host = openNativeScreen(MODULE_ID, { rootCtor: WFIGHT_ROOT_CTOR });
        if (!host) return false;
        w._host = host;
        return true;
    }

    /** The cache ids the resident service currently holds (the loader's requests). */
    function cacheIds() {
        const host = w._host;
        if (!host) return [];
        const ids = [];
        for (let i = 0; i < CACHE_SLOT_COUNT; i++) {
            const base = CACHE_SLOTS + i * 0x10;
            if ((host.read(base, 4) >>> 0) !== 0) ids.push(host.read(base + 4, 4) & 0xffff);
        }
        return ids;
    }

    /** Start the original battle boot pipeline. */
    w.open = () => {
        if (w._open) return;
        w._open = true;
        w._done = false;
        w._framesAlive = 0;
        w._bankIds = [];
        w._lastDiagnostic = null;
        preloadNativeScreens().catch((e) => {
            w._lastDiagnostic = `native screen preload failed: ${e?.message ?? e}`;
        });
        if (!boot()) w._pending = true;
    };

    w.isOpen = () => w._open && !w._done;
    w.isPending = () => w._pending;
    w.active = () => w._open && !!w._host;
    w.isDone = () => w._done;

    w.update = (dt) => {
        if (!w._open || w._done) return;
        if (w._pending) {
            if (!nativeScreensReady()) {
                preloadNativeScreens().catch(() => {});
                return;
            }
            if (!boot()) {
                w._lastDiagnostic = "wfightmn boot failed (manifest/overlay missing)";
                w._done = true;
                return;
            }
            w._pending = false;
        }
        // Only the screen that owns the driver may tick it. If another screen
        // (the battle command menu) has taken the slot, this loader is over.
        if ((nativeScreenState()?.module ?? null) !== MODULE_ID) {
            w._lastDiagnostic = "another native screen took the driver slot";
            w._finish();
            return;
        }
        w._framesAlive++;
        // Safety valve: a loader that never retires must not hold the battle's
        // command phase shut (the pipeline retires in ~40 frames when healthy).
        if (w._framesAlive > 900) {
            w._lastDiagnostic = "wfightmn loader did not retire; released for the battle menu";
            w._finish();
            return;
        }
        // The loader's own tick requests the battle banks; keep the union of the
        // ids the resident cache held while it ran (it releases them at its last
        // stage, so a single sample can miss the window).
        for (const id of cacheIds()) if (!w._bankIds.includes(id)) w._bankIds.push(id);
        const gone = !nativeScreenObjects().some((o) => (o.cb >>> 0) === WFIGHT_LOADER_CB);
        const finished = w._host.tick(dt) || gone;
        w._lastTraps = w._host.state()?.traps ?? w._lastTraps;
        if (finished) w._finish();
    };

    w.close = () => {
        if (w._open) w._finish();
    };

    w._finish = () => {
        if (!w._open) return;
        const host = w._host;
        if (host) {
            w._lastTraps = host.state()?.traps ?? w._lastTraps;
            for (const id of cacheIds()) if (!w._bankIds.includes(id)) w._bankIds.push(id);
            host.teardown();
        }
        w._host = null;
        w._pending = false;
        w._done = true;
        w._open = false;
    };

    /** Diagnostics for the lab and focused browser checks. */
    w.diagnostics = () => ({
        open: w._open,
        pending: w._pending,
        done: w._done,
        framesAlive: w._framesAlive,
        bankIds: w._bankIds.slice(),
        traps: w._host?.state()?.traps ?? w._lastTraps,
        host: w._host?.state() ?? null,
        lastDiagnostic: w._lastDiagnostic,
    });

    return w;
}
