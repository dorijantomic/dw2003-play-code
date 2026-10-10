// Browser adapter for the translated eight-topic help menu (engine/dw3/ui/help-menu-session.ts).
// The logic runs in the engine; this file loads its text (the counter's ESDMG entry, as
// web/dialogue-translated.js loads it), ticks the session on the display clock, turns keys into
// the pressed / repeat pad words, paints the CMFONT window markers and the text, and maps the
// packed sounds. It never executes original instructions and never runs events: the menu starts
// none, so closing it hands control straight back.
import { ui } from "./vendor/engine.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { drawNativeTextWidgets } from "./native-screen-text.js";
import { loadEsdmgEntry, loadResidentResources } from "./resident-data.js";

const PACK_NAMES = { 0x02860000: "cmfont" };
const packName = (handle) => PACK_NAMES[handle >>> 0] ?? null;
/**
 * Game key -> pad bit (identity logical-button map: Up 4, Down 6, confirm 13, Cancel 14). The
 * Cancel bit is the one the Yes/No box does not need: the help menu closes on it (wstag210
 * F0x800A5E74 step 2).
 */
const KEY_BITS = [["up", 1 << 4], ["down", 1 << 6], ["circle", 1 << 13], ["cross", 1 << 14]];

const DATA_LABEL = "Help menu data";

export function createHelpMenuTranslated(sfx = null) {
    const g = {
        _open: false, _pending: false, _failed: false, _error: null, _session: null, _clock: null, _pad: null,
        _ticks: 0, _request: 0, _closes: 0, _sounds: [], _packed: {}, _primed: false, _row: null,
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
        console.error("Translated help menu failed", error);
    }

    /**
     * Open the menu. `menuRow`: a ui.HELP_MENUS row (or ui.helpMenuFor(stage, label)).
     * `packBytes`: its ESDMG entry, or null to load it from web/assets/data/dialogue-box/.
     * `onClose()`: the menu has finished (the player confirmed "Return" or pressed Cancel).
     */
    g.open = async (menuRow, packBytes = null, { onClose = null } = {}) => {
        g._open = true;
        g._pending = true;
        g._failed = false;
        g._error = null;
        g._session = null;
        g._ticks = 0;
        g._packed = {};
        g._primed = false;
        g._row = menuRow;
        const request = ++g._request;
        try {
            const [shared, pack] = await Promise.all([
                loadResidentResources(),
                packBytes ?? loadEsdmgEntry(ui.yesNoTextFile(menuRow.textHandle), menuRow.textHandle & 0xffff, DATA_LABEL),
            ]);
            if (request !== g._request) return;
            const session = new ui.HelpMenuSession({ font: shared.font, ranges: shared.ranges, cursorGlyphs: shared.cursorGlyphs });
            session.open(menuRow, pack, { onClose: () => g._finish(onClose) });
            g._session = session;
            g._clock = new ui.MenuDisplayClock();
            g._pad = new ui.MenuPadWords();
            g._pending = false;
        } catch (error) {
            if (request === g._request) fail(error);
        }
    };

    g.isOpen = () => g._open;

    g.update = (dt, keys = null) => {
        if (!g._open || g._failed || !g._session) return;
        let held = 0;
        for (const [key, bit] of KEY_BITS) if (keys?.has(key)) held |= bit;
        // The press that opened the menu is still down: it is not a new press.
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
        // The eight titles are set whole; the page is the typewriter, so only its revealed run
        // is painted (the same split dialogue-translated.js makes for the conversation box).
        const page = g._session.pageAddress();
        const widgets = g._session.textWidgets();
        g._painted = [
            ...drawNativeTextWidgets(ctx, widgets.filter((w) => w.addr !== page)).texts,
            ...drawNativeTextWidgets(ctx, widgets.filter((w) => w.addr === page), { revealWindow: true }).texts,
        ];
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

    /** Abandon the menu without running onClose (the field left another way). */
    g.close = () => {
        if (!g._open) return;
        g._session?.dispose();
        g._open = false;
        g._pending = false;
        ++g._request;
    };

    g.diagnostics = () => ({
        execution: "translated", open: g._open, pending: g._pending, failed: g._failed, error: g._error?.message ?? null,
        menu: g._row ? { module: g._row.module, label: g._row.label, textHandle: g._row.textHandle } : null,
        ticks: g._ticks, closes: g._closes, painted: (g._painted ?? []).slice(),
        packed: { ...g._packed }, sounds: g._sounds.slice(), state: g._session?.state?.() ?? null, renderer: renderer.stats,
    });

    return g;
}