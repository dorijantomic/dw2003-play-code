// Browser adapter for the translated in-battle TECH list. The list's logic runs
// in engine/dw3/ui (FightTechSession); this file loads its data, forwards the
// held buttons and single presses, paints the picture calls (the CMFONT row
// icon, the PGFGTC00 list window / MP plate / description pane / page arrows)
// and the text widgets, and hands the chosen technique back to web/battle.js.
// It never executes original instructions and never requests an executable
// asset. `?legacyTechList=1` keeps the walker's hand-drawn list
// (web/battle.js drawTechMenu).
//
// Same public API as createBattleCommandTranslated:
// open/update/draw/close/press/isOpen/isPending/active/failed/chosen/
// preload/diagnostics.
import { ui } from "./vendor/engine.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { paintNativeSession } from "./native-session.js";
import { wfightLoaderRegion } from "./wfight-translated.js";
import { fetchBytes, fetchJson, loadResidentResources } from "./resident-data.js";

// The row icon is pack handle 0x00286000 (CMFONT, the resident UI glyphs) and
// the chrome is 0x00455000 (PGFGTC00, disc 1109). The original builds both
// handles with `lui $a0, 0x286` / `lui $a0, 0x455` (fightstg.s:19748, :19760).
const PACK_NAMES = { 0x02860000: "cmfont", 0x04550000: "pgfgc00" };
const PACKS = { 646: "cmfont", 1109: "pgfgc00" };
const BANKS = [0x7f, 0x9b, 0xa2];
const PULSE_BUTTONS = new Set(["up", "down", "left", "right", "circle", "cross", "triangle", "square", "l1", "r1", "start", "select"]);
const DATA_LABEL = "Battle tech data";

let dataPromise = null;
function loadData() {
    dataPromise ??= Promise.all([
        fetchJson("battlecmd/manifest.json", DATA_LABEL),
        fetchBytes("battlecmd/tech-tables.bin", DATA_LABEL),
        fetchBytes("battlecmd/strip.bin", DATA_LABEL),
        loadResidentResources().then((shared) => ({ font: shared.font, cursorGlyphs: shared.cursorGlyphs })),
        ...BANKS.flatMap((bank) =>
            Array.from({ length: 7 }, (_, language) => fetchBytes(`battlecmd/${bank + language}.bin`, DATA_LABEL))),
    ]).then(([manifest, tables, strip, shared, ...bankBytes]) => ({
        manifest, tables, strip, font: shared.font, cursorGlyphs: shared.cursorGlyphs,
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

export function createBattleTechTranslated(sfx = null, options = {}) {
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
        if (language < 0 || language > 6) throw new Error("Battle tech language index is invalid");
        const seed = r._seed;
        r._session = new ui.FightTechSession(language, {
            activeIndex: seed.activeIndex,
            mp: seed.mp,
            maxMp: seed.maxMp,
            noCharge: seed.noCharge,
            techniques: seed.techniques,
        }, { tables: r._data.tables, font: r._data.font, banks: r._data.banks,
             ...(r._data.cursorGlyphs ? { cursorGlyphs: r._data.cursorGlyphs } : {}) }, { playSound });
        r._clock = new ui.MenuDisplayClock();
    }

    function fail(error) {
        r._error = error;
        r._failed = true;
        r._lastDiagnostic = `translated TECH list failed: ${error?.message ?? error}`;
        console.error("Translated battle TECH list failed", error);
    }

    r.preload = () => {
        loadData().then((data) => { r._data = data; }).catch((error) => {
            r._lastDiagnostic = `battle tech data failed to load: ${error?.message ?? error}`;
        });
    };

    /** Open on the party member's technique list. */
    r.open = (seed = {}) => {
        r._open = true;
        r._seed = {
            activeIndex: Math.max(0, Math.min(2, Number(seed.activeIndex ?? 0) | 0)),
            mp: Number(seed.mp ?? 0) & 0xffff,
            maxMp: Number(seed.maxMp ?? 0) & 0xffff,
            noCharge: Number(seed.noCharge ?? 0) & 0xff,
            techniques: (seed.techniques ?? []).map((t) => ({ word: Number(t.word ?? 0) & 0xffff, cost: Number(t.cost ?? 0) | 0 })),
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

    /** A key event as a single press: held for one display tick, then released. */
    r.press = (button) => {
        if (!PULSE_BUTTONS.has(button)) return;
        r._queue.push(button);
        if (r._queue.length > 16) r._queue.shift();
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

    /** One battle update. Returns the chosen technique id, or -2 on a cancel. */
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