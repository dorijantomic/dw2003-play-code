// The one browser-side scaffold every translated battle menu shares: the six
// adapters (web/battlecmd-translated.js, battleitem-, battletech-, battletag-,
// battleform-, battledna-translated.js) had the same open/press/update/draw/close
// machinery copied six times. Each of them keeps what is its own (its data
// files, its engine session, its seed clamping and its diagnostics fields) and
// hands the rest here.
//
// Nothing in this file knows about the battle; it only drives an engine session
// that answers ready()/finished()/moves, the way the original's own menu tasks
// do. It never executes original instructions and never requests an executable
// asset.
import { ui } from "./vendor/engine.js";
import { paintNativeSession } from "./native-session.js";
import { wfightLoaderRegion } from "./wfight-translated.js";

/** The buttons a queued press is allowed to carry. */
export const BATTLE_PULSE_BUTTONS = new Set([
    "up", "down", "left", "right", "circle", "cross", "triangle", "square", "l1", "r1", "start", "select",
]);

/** Queued presses never grow past this; the display reads one per tick anyway. */
export const BATTLE_QUEUE_LIMIT = 16;

/**
 * The menu's language byte, off the player state, defaulting to 2 (English)
 * with the original's seven-language range. Every battle screen resolves it the
 * same way; only the error's wording names the screen.
 */
export function battleMenuLanguage(options, errorText) {
    const state = options?.getState?.() ?? {};
    const selected = state.languageByte;
    const value = Number.isInteger(selected) ? selected : 2;
    if (value < 0 || value > 6) throw new Error(errorText);
    return value;
}

/** The 16bpp strip the marker blit copies from, as an opaque canvas. */
export function stripCanvas(bytes, w, h) {
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
 * The vsync blit's VRAM-to-VRAM copies land on top of the finished frame. The
 * strip is what the battle boot loader uploaded to VRAM; on the `?legacyWfight=1`
 * route no loader ran, so the identical bytes come from the data build.
 */
export function paintStripMoves(ctx, state, moves) {
    const info = state._data?.manifest?.strip;
    if (!info) return;
    const [vx, vy] = info.vram;
    if (!state._strip) {
        const uploaded = wfightLoaderRegion(vx, vy, info.width, info.height);
        state._stripSource = uploaded ? "loader-vram" : "data";
        state._strip = stripCanvas(uploaded ?? state._data.strip, info.width, info.height);
    }
    if (!state._strip) return;
    for (const m of moves ?? []) {
        // Each copy is made twice, once per display buffer (y and y + 0x100);
        // the browser has one picture, so the first buffer's copy is painted.
        if (m.dstY >= 0x100) continue;
        const sx = m.srcX - vx, sy = m.srcY - vy;
        if (sx < 0 || sy < 0 || sx + m.w > info.width || sy + m.h > info.height) {
            state._lastDiagnostic = `VRAM copy from ${m.srcX},${m.srcY} is outside the marker strip`;
            continue;
        }
        ctx.drawImage(state._strip, sx, sy, m.w, m.h, m.dstX, m.dstY, m.w, m.h);
    }
}

/**
 * Build one translated battle menu. `spec` carries only what differs:
 *
 *   renderer          the native screen renderer the file created
 *   load(r)           the file's own data promise (its asset list)
 *   loadFailure       "battle item data failed to load"
 *   failureMessage    "translated ITEM list failed"
 *   failureConsole    "Translated battle ITEM list failed"
 *   languageError     "Battle item language index is invalid"
 *   seed(r, ...args)  clamp the caller's seed into r._seed (r.open's arguments)
 *   beforeLoad(r)     resolve anything load() needs first (the DNA language)
 *   start(r, data, language, playSound)   the engine session
 *   canQueue(r, session)                  whether a queued press may go in  (default ready())
 *   answer(r, session)                    { value } once the session answers, else null
 *   paintTarget(r)                        the session whose moves are blitted (default r._session)
 *   done(session)                         whether the session closed itself (default finished())
 *   onOpen(r) / onFail(r)                 extra resets / teardown
 *   readChosen(r)                         the value chosen() answers (default r._chosen)
 *   diagnostics(r)                        the screen's own fields, after the shared ones
 *   chosenField === false                 do not emit the shared `chosen` field
 *   extraApi(r)                           the screen's own read-only extras
 *   pulseButtons / queueLimit / countPresses
 */
export function createBattleMenuAdapter(spec) {
    const r = {
        _open: false, _session: null, _data: null, _error: null, _failed: false, _loading: false,
        _seed: null, _clock: null, _queue: [], _strip: null, _stripSource: null,
        _ticks: 0, _chosen: null, _lastDiagnostic: null,
        _releaseTicks: 0, _pulse: null,
        // The screen's own fields (its chosen row, its answer word) start here so
        // diagnostics() answers them before the screen is ever opened.
        ...spec.state,
    };
    const renderer = spec.renderer;
    const queueLimit = spec.queueLimit ?? BATTLE_QUEUE_LIMIT;
    const pulseButtons = spec.pulseButtons ?? BATTLE_PULSE_BUTTONS;
    const done = spec.done ?? ((session) => session.finished());

    function fail(error) {
        r._error = error;
        r._failed = true;
        r._lastDiagnostic = `${spec.failureMessage}: ${error?.message ?? error}`;
        console.error(spec.failureConsole, error);
        spec.onFail?.(r);
    }

    r.preload = () => {
        if (spec.beforeLoad) {
            try { spec.beforeLoad(r); } catch (error) { r._loading = false; fail(error); return; }
        }
        r._loading = true;
        spec.load(r).then((data) => { r._data = data; r._loading = false; }).catch((error) => {
            r._loading = false;
            r._lastDiagnostic = `${spec.loadFailure}: ${error?.message ?? error}`;
        });
    };

    function startSession() {
        const language = battleMenuLanguage(spec.options, spec.languageError);
        r._session = spec.start(r, r._data, language, (id) => { spec.sfx?.playPacked(id); });
        r._clock = new ui.MenuDisplayClock();
    }

    /** Open; the arguments are the screen's own (the command list takes a row too). */
    r.open = (...args) => {
        r._open = true;
        r._seed = spec.seed(r, ...args);
        r._chosen = null;
        r._strip = null;
        r._session = null;
        r._queue.length = 0;
        r._pulse = null;
        r._releaseTicks = 0;
        r._lastDiagnostic = null;
        spec.onOpen?.(r);
        if (!r._data) r.preload();
    };

    r.isOpen = () => r._open && !r._failed;
    r.isPending = () => r._open && !r._session && !r._failed;
    r.active = () => r._open && !!r._session;
    r.failed = () => r._failed;
    r.chosen = () => (spec.readChosen ? spec.readChosen(r) : r._chosen);

    /** A key event as a single press: held for one display tick, then released for one. */
    r.press = (button) => {
        if (!pulseButtons.has(button)) return;
        if (spec.countPresses) r._presses = (r._presses ?? 0) + 1;
        r._queue.push(button);
        while (r._queue.length > queueLimit) r._queue.shift();
    };

    function buttonsForTick(held) {
        // A queued press becomes its own edge: one tick down, then one tick up, so
        // two presses never merge into one held stretch. The actor's first tick
        // builds the list, so presses wait until it reads the pad.
        const buttons = new Set(held);
        const canQueue = spec.canQueue ?? ((_, session) => !!session && session.ready());
        if (r._releaseTicks > 0) {
            r._releaseTicks--;
            r._pulse = null;
        } else if (canQueue(r, r._session) && r._queue.length > 0) {
            r._pulse = r._queue.shift();
            buttons.add(r._pulse);
            r._releaseTicks = 1;
        }
        return buttons;
    }

    /** One battle update. Returns the screen's answer on the update it is handed back, else null. */
    r.update = (keys, dt = 1 / 60) => {
        if (!r._open || r._failed) return null;
        if (!r._session) {
            if (!r._data) {
                if (!r._loading) r.preload();
                return null;
            }
            try { startSession(); } catch (error) { fail(error); return null; }
        }
        const held = keys ? [...keys] : [];
        try {
            for (const frame of r._clock.advance(dt)) {
                r._session.tick(buttonsForTick(held), frame.tick);
                r._ticks++;
                const answered = spec.answer?.(r, r._session);
                if (answered) return answered.value;
            }
        } catch (error) {
            fail(error);
        }
        return null;
    };

    r.draw = (ctx, viewW = 320) => {
        if (!r._open || !r._session) return;
        const target = spec.paintTarget ? spec.paintTarget(r) : r._session;
        if (!target) return;
        const s = viewW / 320;
        ctx.save();
        ctx.scale(s, s);
        paintNativeSession(ctx, renderer, target, { fade: false });
        paintStripMoves(ctx, r, target.moves);
        ctx.restore();
    };

    r.close = () => {
        if (!r._open) return;
        r._open = false;
        const session = r._session;
        r._session = null;
        if (session && !done(session)) session.dispose();
    };

    r.diagnostics = () => ({
        execution: "translated",
        open: r._open,
        pending: r.isPending(),
        queued: r._queue.length,
        failed: r._failed,
        error: r._error?.message ?? null,
        ...(spec.chosenField === false ? {} : { chosen: r._chosen }),
        ...spec.diagnostics?.(r),
        seed: r._seed,
        stripSource: r._stripSource,
        renderer: renderer.stats,
        lastDiagnostic: r._lastDiagnostic,
    });

    spec.extraApi?.(r);
    return r;
}
