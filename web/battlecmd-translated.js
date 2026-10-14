// Browser adapter for the translated battle command list (Fight / Tech / DV /
// Tag / Item / Run). The list's logic runs in engine/dw3/ui (FightCommandSession);
// this file loads its data, forwards the held buttons and single presses, paints
// the picture calls, the six names and the pulsing marker, and hands the chosen
// row back to web/battle.js. It never executes original instructions and never
// requests an executable asset. `?nativeBattleCmd=1` keeps the original-code list
// as a research reference (web/battlecmd-native.js); `?legacyBattleCmd=1` keeps the
// walker's hand-made list.
//
// Same public API as createBattleCommandNative: open/update/draw/close/press/
// isOpen/isPending/active/failed/chosen/preload/diagnostics.
//
// The confused player's list is the SAME widget on the original's joke config:
// `seed.jokeIndices` (the shuffle's first six joke indices, from
// engine/dw3/battle-confusion.ts shuffleJokeMenu) opens it as pro/fightstg's
// joke owner F0x8009A898, whose rows are the eight joke commands 0x6B+index,
// never greyed, and whose confirm answers with the chosen joke row instead of a
// command. `?legacyJokeMenu=1` (read by web/battle.js) keeps the walker's own
// hand-drawn list for that case.
import { ui } from "./vendor/engine.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { paintNativeSession } from "./native-session.js";
import { wfightLoaderRegion } from "./wfight-translated.js";
import { fetchBytes, fetchJson, loadResidentResources } from "./resident-data.js";

/** The row picture pack: handle 0x04550000 is disc index 1109, PGFGTC00. */
const PACKS = { 1109: "pgfgc00" };
const NAME_BANK = 0x7f;
const PULSE_BUTTONS = new Set(["up", "down", "left", "right", "circle", "cross", "triangle", "square", "start", "select"]);

const DATA_LABEL = "Battle command data";

let dataPromise = null;
function loadData() {
    dataPromise ??= Promise.all([
        fetchJson("battlecmd/manifest.json", DATA_LABEL),
        fetchBytes("battlecmd/tables.bin", DATA_LABEL),
        fetchBytes("battlecmd/strip.bin", DATA_LABEL),
        loadResidentResources().then((shared) => ({ font: shared.font, cursorGlyphs: shared.cursorGlyphs })),
        ...Array.from({ length: 7 }, (_, language) => fetchBytes(`battlecmd/${NAME_BANK + language}.bin`, DATA_LABEL)),
    ]).then(([manifest, tables, strip, shared, ...banks]) => ({
        manifest, tables, strip, font: shared.font, cursorGlyphs: shared.cursorGlyphs,
        banks: new Map(banks.map((data, language) => [NAME_BANK + language, data])),
    })).catch((error) => { dataPromise = null; throw error; });
    return dataPromise;
}

/** The 16bpp strip the vsync blit copies from, as an opaque canvas (framebuffer pixels). */
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

/**
 * The acting member's ailment byte (record +0x1C): 0x01 Poison, 0x02 Frozen,
 * 0x04 Confusion, 0x08 Sleep, 0x10 the cannot-flee lock, 0x20 the
 * cannot-digivolve lock. The two locks are set by FIGHTSTG_F0x8009cd1c with the
 * record's own bits (`ori $v0, 0x10` :27134 / `ori $v0, 0x20` :27141) and cleared
 * by the pool's expiry (`pro/wfightmn.s:2743-:2773`); the walker keeps them as
 * per-record booleans, so the byte the escape roll, the command-menu row greys
 * (F0x80093cf4 :17595) and the DNA tests read carries them too.
 */
export function battleAilmentByte(member) {
    if (Number.isInteger(member?.statusBits)) return member.statusBits & 0xff;
    const a = member?.ailments ?? {};
    return (a.poison ? 0x01 : 0) | (a.frozen ? 0x02 : 0) | (a.confuse ? 0x04 : 0) | (a.sleep ? 0x08 : 0)
        | (member?.cantFlee ? 0x10 : 0) | (member?.cantDigivolve ? 0x20 : 0);
}

export function createBattleCommandTranslated(sfx = null, options = {}) {
    const r = {
        _open: false, _session: null, _data: null, _error: null, _failed: false,
        _row: 0, _seed: null, _clock: null, _queue: [], _pulse: null, _pulseTicks: 0,
        _releaseTicks: 0, _presses: 0, _chosen: null, _strip: null, _stripSource: null, _ticks: 0,
        _lastDiagnostic: null,
    };
    const renderer = createNativeScreenRenderer({ pack: "pgfgc00", packs: PACKS },
        (directory) => PACKS[directory >>> 16] ?? null);

    const playSound = (id) => { sfx?.playPacked(id); };

    function startSession() {
        const state = options.getState?.() ?? {};
        const selected = state.languageByte;
        const language = Number.isInteger(selected) ? selected : 2;
        if (language < 0 || language > 6) throw new Error("Battle command language index is invalid");
        const joke = r._seed.jokeIndices;
        r._session = new ui.FightCommandSession(language, {
            // The joke owner always opens on its first row (F0x8009AB74 stores 0).
            initialRow: joke ? 0 : r._row,
            activeIndex: r._seed.activeIndex,
            ailmentBits: r._seed.ailmentBits,
            // FIGHTSTG_F0x8009A2DC adds 0x6B to the shuffled table's entry per row.
            jokeLabels: joke ? joke.map((index) => (Number(index) | 0) + ui.JOKE_LABEL_BASE) : null,
        }, { tables: r._data.tables, font: r._data.font, banks: r._data.banks,
             ...(r._data.cursorGlyphs ? { cursorGlyphs: r._data.cursorGlyphs } : {}) }, { playSound });
        r._clock = new ui.MenuDisplayClock();
    }

    function fail(error) {
        r._error = error;
        r._failed = true;
        r._lastDiagnostic = `translated command list failed: ${error?.message ?? error}`;
        console.error("Translated battle command list failed", error);
    }

    r.preload = () => {
        loadData().then((data) => { r._data = data; }).catch((error) => {
            r._lastDiagnostic = `battle command data failed to load: ${error?.message ?? error}`;
        });
    };

    /** Open at `initialRow`; `seed` carries the acting party slot, its ailment byte
     *  and, when the acting Digimon is confused, the shuffle's six joke indices. */
    r.open = (initialRow = 0, seed = {}) => {
        r._open = true;
        r._row = Math.max(0, Math.min(5, Number(initialRow) | 0));
        const joke = seed.jokeIndices ?? null;
        r._seed = {
            activeIndex: Math.max(0, Math.min(2, Number(seed.activeIndex) | 0)),
            ailmentBits: Number(seed.ailmentBits) & 0xff,
            jokeIndices: joke && joke.length === 6 ? joke.map((v) => Number(v) | 0) : null,
        };
        r._chosen = null;
        r._strip = null;
        r._session = null;
        r._queue.length = 0;
        r._pulse = null;
        r._pulseTicks = 0;
        r._releaseTicks = 0;
        r._lastDiagnostic = null;
        if (!r._data) r.preload();
    };

    r.isOpen = () => r._open && !r._failed;
    r.isPending = () => r._open && !r._session && !r._failed;
    r.active = () => r._open && !!r._session;
    r.failed = () => r._failed;
    r.chosen = () => r._chosen;

    /** A key event as a single press: held for one display tick, then released for one. */
    r.press = (button) => {
        if (!PULSE_BUTTONS.has(button)) return;
        r._presses++;
        r._queue.push(button);
        if (r._queue.length > 16) r._queue.shift();
    };

    function buttonsForTick(held) {
        // A queued press becomes its own edge: one tick down, then one tick up, so
        // two presses never merge into one held stretch. The actor's first tick
        // builds the list, so presses wait until it reads the pad.
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

    /** One battle update. Returns the chosen row (0..5) on the update it is handed back, else null. */
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
                // The joke owner closes itself on the confirm and answers with the
                // chosen joke; the command actor writes its out word instead.
                const joke = r._session.joke();
                if (joke !== null) {
                    r._chosen = joke;
                    return joke;
                }
                if (r._session.finished()) {
                    const row = r._session.chosen();
                    r._chosen = row;
                    return row;
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
            // The strip is what the battle boot loader uploaded to VRAM (0, 0xF4). On the
            // `?legacyWfight=1` route no loader ran, so the identical bytes come from the data build.
            const uploaded = wfightLoaderRegion(vx, vy, info.width, info.height);
            r._stripSource = uploaded ? "loader-vram" : "data";
            r._strip = stripCanvas(uploaded ?? r._data.strip, info.width, info.height);
        }
        if (!r._strip) return;
        for (const m of r._session.moves) {
            // Each copy is made twice, once per display buffer (y and y + 0x100);
            // the browser has one picture, so the first buffer's copy is painted.
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
        row: r._row,
        queued: r._queue.length,
        presses: r._presses,
        failed: r._failed,
        error: r._error?.message ?? null,
        chosen: r._chosen,
        ticks: r._ticks,
        selection: r._session?.selection() ?? null,
        ready: r._session?.ready() ?? false,
        joke: r._session?.joke() ?? null,
        tasks: r._session?.tree.tasks.size ?? 0,
        vsync: r._session?.vsyncInstalled() ?? false,
        moves: r._session?.moves.map((m) => ({ ...m })) ?? [],
        seed: r._seed,
        stripSource: r._stripSource,
        renderer: renderer.stats,
        lastDiagnostic: r._lastDiagnostic,
    });

    return r;
}
