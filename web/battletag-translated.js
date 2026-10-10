// Browser adapter for the translated in-battle TAG (partner) list. The list's
// logic runs in engine/dw3/ui (FightTagSession); this file loads its data, forwards
// the held buttons and single presses, paints the picture calls (the PGFGTC00
// HP/MP plate, the CMFONT blinking hand of the "no partner left" screen) and the
// text widgets, and hands the chosen party slot back to web/battle.js. It never
// executes original instructions and never requests an executable asset.
// `?legacyTagList=1` keeps the walker's hand-drawn list (web/battle.js
// drawTagMenu).
//
// Same public API as createBattleCommandTranslated:
// open/update/draw/close/press/isOpen/isPending/active/failed/chosen/
// preload/diagnostics.
import { ui, rosterSlotOfCharId } from "./vendor/engine.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { paintNativeSession } from "./native-session.js";
import { encodeNativeScreenText } from "./native-screen.js";
import { wfightLoaderRegion } from "./wfight-translated.js";
import { fetchBytes, fetchJson, loadProfileRecords, loadResidentResources } from "./resident-data.js";

// The chrome is 0x00455000 (PGFGTC00, disc 1109) and the blinking hand is
// 0x00286000 (CMFONT, the resident UI glyphs). The original builds both handles
// with `lui $a0, 0x455` / `lui $a0, 0x286` (fightstg.s:21454 / :20858).
const PACK_NAMES = { 0x02860000: "cmfont", 0x04550000: "pgfgc00" };
const PACKS = { 646: "cmfont", 1109: "pgfgc00" };
// The tag list's only text bank is the battle UI words (0x7F); each row's NAME
// is the member's OWN record string at DIGIMON_CUR_STATS + slot*0x3DC, reached
// through ctx+0x2718 -> ctx+0x2750, not through a text bank. (The predecessor
// loaded bank 0x4E and read a species word there; that showed the species name
// and lost a renamed partner's name.)
const BANKS = [0x7f];
const PULSE_BUTTONS = new Set(["up", "down", "left", "right", "circle", "cross", "triangle", "square", "l1", "r1", "start", "select"]);
const DATA_LABEL = "Battle tag data";

let dataPromise = null;
function loadData() {
    dataPromise ??= Promise.all([
        fetchJson("battlecmd/manifest.json", DATA_LABEL),
        fetchBytes("battlecmd/tag-tables.bin", DATA_LABEL),
        fetchBytes("battlecmd/strip.bin", DATA_LABEL),
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

/** The name string the species service hands a row's plate. */
export function createBattleTagTranslated(sfx = null, options = {}) {
    const r = {
        _open: false, _session: null, _data: null, _error: null, _failed: false,
        _seed: null, _clock: null, _queue: [], _strip: null, _stripSource: null,
        _ticks: 0, _chosen: null, _row: null, _lastDiagnostic: null,
        _releaseTicks: 0, _pulse: null,
    };
    const renderer = createNativeScreenRenderer({ packs: PACKS, pack: "pgfgc00" },
        (directory) => PACK_NAMES[directory >>> 0] ?? null);

    const playSound = (id) => { sfx?.playPacked(id); };

    function startSession() {
        const state = options.getState?.() ?? {};
        const selected = state.languageByte;
        const language = Number.isInteger(selected) ? selected : 2;
        if (language < 0 || language > 6) throw new Error("Battle tag language index is invalid");
        const seed = r._seed;
        r._session = new ui.FightTagSession(language, {
            activeIndex: seed.activeIndex,
            interactive: seed.interactive,
            cursorRow: seed.cursorRow,
            members: seed.members,
        }, { tables: r._data.tables, profiles: r._data.profiles, font: r._data.font, banks: r._data.banks,
             ...(r._data.cursorGlyphs ? { cursorGlyphs: r._data.cursorGlyphs } : {}) },
           { playSound });
        r._clock = new ui.MenuDisplayClock();
    }

    function fail(error) {
        r._error = error;
        r._failed = true;
        r._lastDiagnostic = `translated TAG list failed: ${error?.message ?? error}`;
        console.error("Translated battle TAG list failed", error);
    }

    r.preload = () => {
        loadData().then((data) => { r._data = data; }).catch((error) => {
            r._lastDiagnostic = `battle tag data failed to load: ${error?.message ?? error}`;
        });
    };

    /** Open on the two partners that are not the acting member. */
    r.open = (seed = {}) => {
        r._open = true;
        const state = options.getState?.() ?? {};
        const party = Array.isArray(state.party) ? state.party : [];
        r._seed = {
            activeIndex: Math.max(0, Math.min(2, Number(seed.activeIndex ?? 0) | 0)),
            interactive: Number(seed.interactive ?? 1) ? 1 : 0,
            cursorRow: Math.max(0, Math.min(1, Number(seed.cursorRow ?? 0) | 0)),
            // Each row is a party POSITION. The disc seats the member's ROSTER SLOT
            // at ctx+0x70 and names the row from that member's own record, so the
            // adapter resolves the slot from the party's character id and encodes
            // the member's own name (a rename follows; a reorder cannot mis-name).
            members: (seed.members ?? []).map((m, i) => ({
                digimonId: Number(m.digimonId ?? 0) | 0,
                hp: Number(m.hp ?? 0) & 0xffff,
                maxHp: Number(m.maxHp ?? 0) & 0xffff,
                mp: Number(m.mp ?? 0) & 0xffff,
                maxMp: Number(m.maxMp ?? 0) & 0xffff,
                rosterSlot: rosterSlotOfCharId(String(party[i] ?? "")) ?? i,
                nameBytes: encodeNativeScreenText(String(m.name ?? ""), 23),
                forms: m.forms,
                blast: !!m.blast,
            })),
        };
        r._chosen = null;
        r._row = null;
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
    r.chosenRow = () => r._row;

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
        } else if (r._session && r._session.ready() && r._queue.length > 0) {
            r._pulse = r._queue.shift();
            buttons.add(r._pulse);
            r._releaseTicks = 1;
        }
        return buttons;
    }

    /** One battle update. Returns the chosen party slot, or -2 on a cancel. */
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
                    r._chosen = r._session.chosen();
                    r._row = r._session.chosenRow();
                    return r._chosen;
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
        row: r._row,
        ticks: r._ticks,
        selection: r._session?.selection() ?? null,
        rows: r._session?.rows() ?? null,
        candidates: r._session?.candidates() ?? null,
        panels: r._session?.panels() ?? null,
        message: r._session?.messageOpen() ?? false,
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