// Browser adapter for the translated in-battle Digivolve form list. The list's
// logic runs in engine/dw3/ui (FightFormSession); this file loads its data,
// forwards the held buttons and single presses, paints the picture calls (the
// per-row highlight cel, the panel's page arrows and its page cels) and the text
// widgets, and hands the chosen species id back to web/battle.js. It never
// executes original instructions and never requests an executable asset.
// `?legacyFormList=1` keeps the walker's hand-drawn list
// (web/battle.js drawFormMenu).
//
// Same public API as createBattleTechTranslated:
// open/update/draw/close/press/isOpen/isPending/active/failed/chosen/
// preload/diagnostics.
import { ui } from "./vendor/engine.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { paintNativeSession } from "./native-session.js";
import { wfightLoaderRegion } from "./wfight-translated.js";
import { fetchBytes, fetchJson, loadProfileRecords, loadResidentResources } from "./resident-data.js";

// The panel's chrome is pack handle 0x00455000 (PGFGTC00) and its icons
// 0x00286000 (CMFONT); the list model's marker strip is the same one the TECH
// list blits (the shared list model F0x8009AF4C is the same object).
const PACK_NAMES = { 0x02860000: "cmfont", 0x04550000: "pgfgc00" };
const PACKS = { 646: "cmfont", 1109: "pgfgc00" };
const BANKS = [0x4e, 0x7f, 0xa2];
const PULSE_BUTTONS = new Set(["up", "down", "left", "right", "circle", "cross", "triangle", "square", "l1", "r1", "start", "select"]);
const DATA_LABEL = "Battle form data";

let dataPromise = null;
function loadData() {
    dataPromise ??= Promise.all([
        fetchJson("battlecmd/manifest.json", DATA_LABEL),
        fetchBytes("battlecmd/form-tables.bin", DATA_LABEL),
        fetchBytes("battlecmd/strip.bin", DATA_LABEL),
        // The disc's own 55 profile records at 0x8003EF5C, the same shared slice
        // the DNA pane reads: the list's current form and every row's name and
        // base stats come out of that table.
        loadProfileRecords(DATA_LABEL),
        loadResidentResources().then((shared) => ({ font: shared.font, cursorGlyphs: shared.cursorGlyphs })),
        ...BANKS.flatMap((bank) =>
            Array.from({ length: 7 }, (_, language) => fetchBytes(`battlecmd/${bank + language}.bin`, DATA_LABEL))),
    ]).then(([manifest, tables, strip, profiles, shared, ...bankBytes]) => ({
        manifest, tables, strip, profiles, font: shared.font, cursorGlyphs: shared.cursorGlyphs,
        banks: new Map(BANKS.flatMap((bank, i) =>
            Array.from({ length: 7 }, (_, language) => [bank + language, bankBytes[i * 7 + language]]))),
    })).catch((error) => { dataPromise = null; throw error; });
    return dataPromise;
}

/** The 16bpp strip the marker blit copies from, as an opaque canvas. */
function stripCanvas(bytes, w, h) {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    const image = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
        const c = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
        const r = c & 0x1f, gg = (c >> 5) & 0x1f, b = (c >> 10) & 0x1f;
        image.data[i * 4] = (r << 3) | (r >> 2);
        image.data[i * 4 + 1] = (gg << 3) | (gg >> 2);
        image.data[i * 4 + 2] = (b << 3) | (b >> 2);
        image.data[i * 4 + 3] = 0xff;
    }
    g.putImageData(image, 0, 0);
    return canvas;
}

export function createBattleFormTranslated(sfx = null, options = {}) {
    const r = {
        _open: false, _session: null, _data: null, _error: null, _failed: false,
        _seed: null, _clock: null, _queue: [], _strip: null, _stripSource: null,
        _ticks: 0, _chosen: null, _lastDiagnostic: null,
        _releaseTicks: 0, _pulse: null,
    };
    const renderer = createNativeScreenRenderer({ packs: PACKS, pack: "pgfgc00" },
        (directory) => PACK_NAMES[directory >>> 0] ?? null);

    const playSound = (id) => { sfx?.playPacked(id); };

    function startSession() {
        const state = options.getState?.() ?? {};
        const selected = state.languageByte;
        const language = Number.isInteger(selected) ? selected : 2;
        if (language < 0 || language > 6) throw new Error("Battle form language index is invalid");
        const seed = r._seed;
        r._session = new ui.FightFormSession(language, {
            activeIndex: seed.activeIndex,
            slotIndex: seed.slotIndex,
            currentSpecies: seed.currentSpecies,
            liveSpecies: seed.liveSpecies,
            reservedForm: seed.reservedForm,
            rosterSlots: seed.rosterSlots,
            options: seed.options,
            equipped: seed.equipped,
            panelBlock: seed.panelBlock,
            preselected: seed.preselected,
        }, { tables: r._data.tables, profiles: r._data.profiles, font: r._data.font, banks: r._data.banks,
             ...(r._data.cursorGlyphs ? { cursorGlyphs: r._data.cursorGlyphs } : {}) }, { playSound });
        r._clock = new ui.MenuDisplayClock();
    }

    function fail(error) {
        r._error = error;
        r._failed = true;
        r._lastDiagnostic = `translated form list failed: ${error?.message ?? error}`;
        console.error("Translated battle form list failed", error);
        // A screen that threw owns nothing: drop its session so draw() stops
        // painting a frozen panel over the walker's own list, which is what the
        // Digivolve phase falls back to once failed() is true (web/battle.js
        // handleKey PLAYER_DV, draw PLAYER_DV).
        const session = r._session;
        r._session = null;
        r._queue.length = 0;
        r._pulse = null;
        r._releaseTicks = 0;
        if (session) session.dispose();
    }

    r.preload = () => {
        loadData().then((data) => { r._data = data; }).catch((error) => {
            r._lastDiagnostic = `battle form data failed to load: ${error?.message ?? error}`;
        });
    };

    /** Open on one party member's four forms. */
    r.open = (seed = {}) => {
        r._open = true;
        r._seed = {
            activeIndex: Math.max(0, Math.min(2, Number(seed.activeIndex ?? 0) | 0)),
            slotIndex: Number(seed.slotIndex ?? 0) | 0,
            currentSpecies: Number(seed.currentSpecies ?? 1) & 0xffff,
            liveSpecies: Number(seed.liveSpecies ?? 1) & 0xffff,
            reservedForm: Number(seed.reservedForm ?? 0) & 0xff,
            rosterSlots: (seed.rosterSlots ?? []).map((v, i) => (Number.isInteger(Number(v)) ? Number(v) : i) | 0),
            options: (seed.options ?? []).map((option) => ({
                species: Number(option.species ?? 0) & 0xffff,
                left: (option.left ?? []).map((v) => Number(v) & 0xffff),
                right: (option.right ?? []).map((v) => Number(v) & 0xffff),
                techs: (option.techs ?? []).map((v) => Number(v) & 0xffff),
                level: Number(option.level ?? 0) & 0xff,
                dvexp: Number(option.dvexp ?? 0) >>> 0,
            })),
            // get_equipped's triple in slot order, -1 for an empty slot.
            equipped: (seed.equipped ?? []).slice(0, 3).map((v) =>
                (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : -1) & 0xffff),
            panelBlock: (seed.panelBlock ?? []).map((v) => Number(v) & 0xffff),
            preselected: Number(seed.preselected ?? 0) & 0xffff,
        };
        r._chosen = null;
        r._strip = null;
        r._session = null;
        r._queue.length = 0;
        r._pulse = null;
        r._releaseTicks = 0;
        r._lastDiagnostic = null;
        if (!r._data) r.preload();
    };

    r.isOpen = () => r._open && !r._failed;
    r.isPending = () => r._open && !r._session && !r._failed;
    r.active = () => r._open && !!r._session;
    r.failed = () => r._failed;
    r.chosen = () => r._chosen;

    /**
     * A key event as a single press: held for one display tick, then released.
     * The queue is deliberately two deep — a burst of key events must not turn
     * into a burst of menu moves seconds later, and the screen only ever reads
     * one press per display tick anyway.
     */
    r.press = (button) => {
        if (!PULSE_BUTTONS.has(button)) return;
        r._queue.push(button);
        while (r._queue.length > 2) r._queue.shift();
    };

    function buttonsForTick(held) {
        const buttons = new Set(held);
        if (r._releaseTicks > 0) {
            r._releaseTicks--;
            r._pulse = null;
        } else if (r._session.ready() && r._queue.length > 0) {
            r._pulse = r._queue.shift();
            buttons.add(r._pulse);
            r._releaseTicks = 1;
        }
        return buttons;
    }

    /** One battle update. Returns the chosen species id, or -2 on a cancel. */
    r.update = (keys, dt = 1 / 60) => {
        if (!r._open || r._failed) return null;
        if (!r._session) {
            if (!r._data) {
                if (!dataPromise) r.preload();
                return null;
            }
            try { startSession(); } catch (error) { fail(error); return null; }
        }
        const held = keys ? [...keys] : [];
        try {
            for (const frame of r._clock.advance(dt)) {
                r._session.tick(buttonsForTick(held), frame.tick);
                r._ticks++;
                if (r._session.finished()) {
                    const chosen = r._session.chosen();
                    r._chosen = chosen;
                    return chosen;
                }
            }
        } catch (error) {
            fail(error);
        }
        return null;
    };

    r.draw = (ctx, viewW = 320) => {
        if (!r._open || !r._session) return;
        const s = viewW / 320;
        ctx.save();
        ctx.scale(s, s);
        paintNativeSession(ctx, renderer, r._session, { fade: false });
        paintMoves(ctx);
        ctx.restore();
    };

    /** The vsync blit's VRAM-to-VRAM copies land on top of the finished frame. */
    function paintMoves(ctx) {
        const info = r._data?.manifest?.strip;
        if (!info) return;
        const [vx, vy] = info.vram;
        if (!r._strip) {
            const uploaded = wfightLoaderRegion(vx, vy, info.width, info.height);
            r._stripSource = uploaded ? "loader-vram" : "data";
            r._strip = stripCanvas(uploaded ?? r._data.strip, info.width, info.height);
        }
        if (!r._strip) return;
        for (const m of r._session.moves) {
            if (m.dstY >= 0x100) continue;
            const sx = m.srcX - vx, sy = m.srcY - vy;
            if (sx < 0 || sy < 0 || sx + m.w > info.width || sy + m.h > info.height) {
                r._lastDiagnostic = `VRAM copy from ${m.srcX},${m.srcY} is outside the marker strip`;
                continue;
            }
            ctx.drawImage(r._strip, sx, sy, m.w, m.h, m.dstX, m.dstY, m.w, m.h);
        }
    }

    r.close = () => {
        if (!r._open) return;
        r._open = false;
        const session = r._session;
        r._session = null;
        if (session && !session.finished()) session.dispose();
    };

    /** The disc's own profile table this screen reads, for the callers that need
     *  the same row lookup (web/battle.js formProfileRow). */
    r.tables = () => (r._data ? { profiles: r._data.profiles } : null);

    r.diagnostics = () => ({
        execution: "translated",
        open: r._open,
        pending: r.isPending(),
        queued: r._queue.length,
        failed: r._failed,
        error: r._error?.message ?? null,
        chosen: r._chosen,
        ticks: r._ticks,
        selection: r._session?.selection() ?? null,
        page: r._session?.page() ?? null,
        rows: r._session?.rows() ?? null,
        panelBlock: r._session?.panelBlock() ?? null,
        panelRows: r._session?.panelRows() ?? null,
        panelHeadline: r._session?.panelHeadline() ?? null,
        species: r._session?.rowSpecies() ?? null,
        ready: r._session?.ready() ?? false,
        tasks: r._session?.tree.tasks.size ?? 0,
        vsync: r._session?.vsyncInstalled() ?? false,
        moves: r._session?.moves.map((m) => ({ ...m })) ?? [],
        sounds: r._session?.sounds ?? [],
        seed: r._seed,
        stripSource: r._stripSource,
        renderer: renderer.stats,
        lastDiagnostic: r._lastDiagnostic,
    });

    return r;
}