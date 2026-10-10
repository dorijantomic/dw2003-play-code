// Browser adapter for the translated field Yes/No question box (engine/dw3/ui/yesno-session.ts). The
// logic runs in the engine; this file loads its text (the launcher's ESDMG entry, as
// web/dialogue-translated.js loads it), ticks the session on the display clock, turns keys into the
// pressed / repeat pad words, paints the CMFONT window clip and the text, and maps the packed sounds.
// It never executes original instructions and never runs events: start_event is handed to the host.
import { ui } from "./vendor/engine.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { drawNativeTextWidgets } from "./native-screen-text.js";
import { loadEsdmgEntry, loadResidentResources } from "./resident-data.js";

const PACK_NAMES = { 0x02860000: "cmfont" };
const packName = (handle) => PACK_NAMES[handle >>> 0] ?? null;
/** Game key -> pad bit (identity logical-button map: Up 4, Down 6, confirm 13). */
const KEY_BITS = [["up", 1 << 4], ["down", 1 << 6], ["circle", 1 << 13]];

const DATA_LABEL = "YesNo data";

export function createYesNoTranslated(sfx = null) {
    const g = {
        _open: false, _pending: false, _failed: false, _error: null, _session: null, _clock: null, _pad: null,
        _ticks: 0, _request: 0, _closes: 0, _events: [], _sounds: [], _packed: {}, _primed: false, _row: null,
    };
    const renderer = createNativeScreenRenderer({ pack: "cmfont", packs: { "646:0": "cmfont" } }, packName);

    const playSound = (id) => {
        const key = id >>> 0;
        g._packed[key] = (g._packed[key] ?? 0) + 1;
        g._sounds.push(key);
        if (g._sounds.length > 256) g._sounds.splice(0, g._sounds.length - 256);
        sfx?.playPacked(key);
    };

    function fail(error) {
        g._error = error;
        g._failed = true;
        console.error("Translated yes/no box failed", error);
    }

    /**
     * Open the box. `launcherRow`: a ui.YESNO_LAUNCHERS row (or ui.yesNoLauncherFor(stage, label)).
     * `packBytes`: its ESDMG entry, or null to load it from web/assets/data/dialogue-box/.
     * `onStartEvent(id)`: run the event, then call g.childDone(). `onClose()`: the box has finished.
     */
    g.open = async (launcherRow, packBytes = null, { onStartEvent = null, onClose = null } = {}) => {
        g._open = true;
        g._pending = true;
        g._failed = false;
        g._error = null;
        g._session = null;
        g._ticks = 0;
        g._packed = {};
        g._events = [];
        g._primed = false;
        g._row = launcherRow;
        const request = ++g._request;
        try {
            const [shared, pack] = await Promise.all([
                loadResidentResources(),
                packBytes ?? loadEsdmgEntry(ui.yesNoTextFile(launcherRow.textHandle), launcherRow.textHandle & 0xffff, DATA_LABEL),
            ]);
            if (request !== g._request) return;
            const session = new ui.YesNoSession({ font: shared.font, ranges: shared.ranges, cursorGlyphs: shared.cursorGlyphs });
            session.open(launcherRow, pack, {
                onStartEvent: (id) => { g._events.push(id); onStartEvent?.(id); },
                onClose: () => g._finish(onClose),
            });
            g._session = session;
            g._clock = new ui.MenuDisplayClock();
            g._pad = new ui.MenuPadWords();
            g._pending = false;
        } catch (error) {
            if (request === g._request) fail(error);
        }
    };

    g.isOpen = () => g._open;
    /** The event the box started has ended (extra+0x10 reads 0); the box closes on its next tick. */
    g.childDone = () => { g._session?.childDone(); };

    g.update = (dt, keys = null) => {
        if (!g._open || g._failed || !g._session) return;
        let held = 0;
        for (const [key, bit] of KEY_BITS) if (keys?.has(key)) held |= bit;
        // The press that opened the box is still down: it is not a new press.
        if (!g._primed) { g._primed = true; g._pad.update(held, 0); }
        try {
            for (const frame of g._clock.advance(dt)) {
                const { pressed, repeated } = g._pad.update(held, frame.tick);
                const session = g._session;
                session.tick({ pressed, repeat: repeated });
                g._ticks++;
                for (const id of session.takeSounds()) playSound(id);
                if (!session.isOpen() || g._session !== session) return;
            }
        } catch (error) {
            fail(error);
        }
    };

    g.draw = (ctx, viewW = 320, viewH = 240) => {
        if (!g._open || !g._session) return;
        const s = Math.max(1, Math.min(viewW / 320, viewH / 240));
        const { calls, contextMarkers } = g._session.drawIntents();
        ctx.save();
        ctx.scale(s, s);
        renderer.draw(ctx, calls, null, [], contextMarkers, []);
        g._painted = drawNativeTextWidgets(ctx, g._session.textWidgets()).texts;
        ctx.restore();
    };

    g._finish = (cb) => {
        if (!g._open) return;
        g._open = false;
        g._pending = false;
        g._closes++;
        ++g._request;
        cb?.();
    };

    /** Abandon the box without running onClose (the field left another way). */
    g.close = () => {
        if (!g._open) return;
        g._session?.dispose();
        g._open = false;
        g._pending = false;
        ++g._request;
    };

    g.diagnostics = () => ({
        execution: "translated", open: g._open, pending: g._pending, failed: g._failed, error: g._error?.message ?? null,
        launcher: g._row ? { module: g._row.module, label: g._row.label } : null,
        ticks: g._ticks, closes: g._closes, events: g._events.slice(), painted: (g._painted ?? []).slice(),
        packed: { ...g._packed }, sounds: g._sounds.slice(), state: g._session?.state?.() ?? null, renderer: renderer.stats,
    });

    return g;
}
