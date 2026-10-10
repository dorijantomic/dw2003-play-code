// Browser adapter for the translated in-battle ITEM list. The list's logic runs
// in engine/dw3/ui (FightItemSession); this file loads its data, forwards the
// held buttons and single presses, paints the picture calls (the CMFONT row
// icon, the PGFGTC00 list window / quantity pane / description pane / page
// arrows) and the text widgets, and hands the chosen item back to web/battle.js.
// It never executes original instructions and never requests an executable
// asset. `?legacyItemList=1` keeps the walker's hand-drawn list
// (web/battle.js drawItemMenu).
//
// Same public API as createBattleCommandTranslated:
// open/update/draw/close/press/isOpen/isPending/active/failed/chosen/
// preload/diagnostics.
import { ui } from "./vendor/engine.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { paintNativeSession } from "./native-session.js";
import { wfightLoaderRegion } from "./wfight-translated.js";
import { fetchBytes, fetchJson, loadResidentResources } from "./resident-data.js";
import { itemIconClip } from "./itemicons.js";

// The row icon is pack handle 0x00286000 (CMFONT, the resident UI glyphs) and
// the chrome is 0x00455000 (PGFGTC00, disc 1109): the original builds both
// handles with `lui $a0, 0x286` / `lui $a0, 0x455` (fightstg.s:19096, :19130).
const PACK_NAMES = { 0x02860000: "cmfont", 0x04550000: "pgfgc00" };
const PACKS = { 646: "cmfont", 1109: "pgfgc00" };
// Bank 0x7F is the battle command data's own; the item names (0x6A) and the
// item descriptions (0x63) are the merchant screens' shared banks, already
// extracted (web/assets/data/shop-banks).
const BANKS = [0x7f, 0x6a, 0x63];
const SHOP_BANK_DIRS = { 0x7f: "battlecmd", 0x6a: "shop-banks", 0x63: "shop-banks" };
const PULSE_BUTTONS = new Set(["up", "down", "left", "right", "circle", "cross", "triangle", "square", "l1", "r1", "start", "select"]);
const DATA_LABEL = "Battle item data";

let dataPromise = null;
function loadData() {
    dataPromise ??= Promise.all([
        fetchJson("battlecmd/manifest.json", DATA_LABEL),
        // The ITEM config block at 0x800A3534 and TECH's at 0x800A3554 hold the
        // same eight words {1,14,69,14,-1,0,0,0} (fightstg.s:33941-33968), so the
        // shipped TECH table's first 40 bytes are this screen's own bytes too;
        // tests/lane-b/fight-item-menu.test.js pins that equality.
        fetchBytes("battlecmd/tech-tables.bin", DATA_LABEL),
        fetchBytes("battlecmd/strip.bin", DATA_LABEL),
        loadResidentResources().then((shared) => ({ font: shared.font, cursorGlyphs: shared.cursorGlyphs })),
        ...BANKS.flatMap((bank) => {
            const dir = SHOP_BANK_DIRS[bank];
            return Array.from({ length: 7 }, (_, language) => fetchBytes(`${dir}/${bank + language}.bin`, DATA_LABEL));
        }),
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

export function createBattleItemTranslated(sfx = null, options = {}) {
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
        if (language < 0 || language > 6) throw new Error("Battle item language index is invalid");
        const seed = r._seed;
        r._session = new ui.FightItemSession(language, { items: seed.items },
            { tables: r._data.tables.subarray(0, ui.FIGHT_ITEM_TABLES_SIZE), font: r._data.font,
                banks: r._data.banks,
                ...(r._data.cursorGlyphs ? { cursorGlyphs: r._data.cursorGlyphs } : {}) }, { playSound });
        r._clock = new ui.MenuDisplayClock();
    }

    function fail(error) {
        r._error = error;
        r._failed = true;
        r._lastDiagnostic = `translated ITEM list failed: ${error?.message ?? error}`;
        console.error("Translated battle ITEM list failed", error);
    }

    r.preload = () => {
        loadData().then((data) => { r._data = data; }).catch((error) => {
            r._lastDiagnostic = `battle item data failed to load: ${error?.message ?? error}`;
        });
    };

    /** Open on the carried items the original's own filter would offer. */
    r.open = (seed = {}) => {
        r._open = true;
        r._seed = {
            items: (seed.items ?? []).map((item) => ({
                id: Number(item.id ?? 0) & 0xffff,
                qty: Number(item.qty ?? 0) & 0xff,
                // The exe's cel table at 0x80042BA8 is the clip table
                // web/itemicons-data.js ships; itemIconClip is that mapping.
                family: Number(item.family ?? 0) & 0xff,
            })),
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

    /** One battle update. Returns the chosen item id, or -2 on a cancel. */
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
        count: r._session?.count() ?? null,
        ids: r._session?.ids() ?? null,
        ready: r._session?.ready() ?? false,
        tasks: r._session?.tree.tasks.size ?? 0,
        vsync: r._session?.vsyncInstalled() ?? false,
        moves: r._session?.moves.map((m) => ({ ...m })) ?? [],
        sounds: r._session?.sounds ?? [],
        seed: r._seed,
        icons: r._seed?.items.map((item) => ({ id: item.id, clip: itemIconClip(item.id) })) ?? [],
        stripSource: r._stripSource,
        renderer: renderer.stats,
        lastDiagnostic: r._lastDiagnostic,
    });

    return r;
}