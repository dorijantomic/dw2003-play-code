// Browser adapter for the translated battle boot loader (pro/wfightmn's root task).
// The loader's logic runs in engine/dw3/ui (WfightLoaderSession); this file loads
// its data, ticks it on the display clock and reports when it has retired. It never
// executes original instructions and never requests an executable asset.
// `?nativeWfight=1` keeps the original-code loader as a research reference
// (web/wfightmn-native.js); `?legacyWfight=1` skips the boot loader entirely.
//
// Same public API as createWfightNative: open/update/close/isOpen/isPending/active/
// isDone/diagnostics.
import { ui } from "./vendor/engine.js";
import { fetchBytes, fetchJson } from "./resident-data.js";

/** The loader's data directory under assets/data/. */
const LOADER_DIR = "wfight";
const DATA_LABEL = "Battle loader data";

let dataPromise = null;
function loadData() {
    dataPromise ??= fetchJson(`${LOADER_DIR}/manifest.json`, DATA_LABEL).then(async (manifest) => {
        const shipped = manifest.resources.filter((r) => r.file);
        const files = await Promise.all(shipped.map((r) => fetchBytes(`${LOADER_DIR}/${r.file}`, DATA_LABEL)));
        return { manifest, packs: new Map(shipped.map((r, i) => [r.id, files[i]])) };
    }).catch((error) => { dataPromise = null; throw error; });
    return dataPromise;
}

/** The VRAM the latest completed loader left behind (the command list's marker strip lives in it). */
let lastVram = null;

/**
 * The pixels the loader uploaded to exactly this VRAM rectangle, or null when no
 * loader has run this page (`?legacyWfight=1`) or it did not upload that rectangle.
 */
export function wfightLoaderRegion(x, y, w, h) {
    return lastVram?.(x, y, w, h) ?? null;
}

export function createWfightTranslated(options = {}) {
    const w = {
        _open: false, _pending: false, _done: false, _failed: false, _session: null, _data: null,
        _clock: null, _ticks: 0, _error: null, _lastDiagnostic: null, _summary: null,
    };

    const fail = (error) => {
        w._error = error;
        w._failed = true;
        w._lastDiagnostic = `translated battle loader failed: ${error?.message ?? error}`;
        console.error("Translated battle loader failed", error);
        w._finish();
    };

    function start() {
        const selected = options.getState?.()?.languageByte;
        const language = Number.isInteger(selected) ? selected : 2;
        w._session = new ui.WfightLoaderSession(language, w._data);
        w._clock = new ui.MenuDisplayClock();
    }

    /** Start the battle boot loader. */
    w.open = () => {
        if (w._open) return;
        w._open = true;
        w._done = false;
        w._failed = false;
        w._pending = true;
        w._session = null;
        w._ticks = 0;
        w._error = null;
        w._lastDiagnostic = null;
        loadData().then((data) => { w._data = data; }).catch((error) => {
            w._lastDiagnostic = `battle loader data failed to load: ${error?.message ?? error}`;
            if (w._open) fail(error);
        });
    };

    w.isOpen = () => w._open && !w._done;
    w.isPending = () => w._pending;
    w.active = () => w._open && !!w._session;
    w.isDone = () => w._done;

    w.update = (dt = 1 / 60) => {
        if (!w._open || w._done) return;
        if (!w._session) {
            if (!w._data) return;
            try { start(); } catch (error) { fail(error); return; }
            w._pending = false;
        }
        try {
            for (const frame of w._clock.advance(dt)) {
                w._session.tick(frame.tick);
                w._ticks++;
                if (w._session.finished()) break;
            }
        } catch (error) {
            fail(error);
            return;
        }
        if (w._session?.finished()) w._finish();
    };

    w.close = () => {
        if (w._open) w._finish();
    };

    w._finish = () => {
        if (!w._open) return;
        const session = w._session;
        if (session) {
            const finished = session.finished();
            w._summary = {
                requested: session.requested.slice(), released: session.released.slice(),
                uploads: session.uploads.map((u) => ({ ...u })), retired: finished,
            };
            // Only a loader that retired by itself leaves its uploads behind.
            if (finished && !w._failed) lastVram = (x, y, ww, h) => session.vramRegion(x, y, ww, h);
            if (!finished) session.dispose();
        }
        w._session = null;
        w._pending = false;
        w._done = true;
        w._open = false;
    };

    w.diagnostics = () => ({
        execution: "translated",
        open: w._open,
        pending: w._pending,
        done: w._done,
        failed: w._failed,
        error: w._error?.message ?? null,
        framesAlive: w._ticks,
        ticks: w._ticks,
        traps: 0,
        state: w._session?.state() ?? null,
        bankIds: w._session ? w._session.requested.slice() : (w._summary?.requested ?? []),
        released: w._summary?.released ?? [],
        uploads: w._session ? w._session.uploads.map((u) => ({ ...u })) : (w._summary?.uploads ?? []),
        retired: w._summary?.retired ?? false,
        host: null,
        lastDiagnostic: w._lastDiagnostic,
    });

    return w;
}
