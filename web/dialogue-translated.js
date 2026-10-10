// Browser adapter for the translated field conversation box (engine/dw3/ui/dialogue-session.ts):
// the plain bottom window and the four-quadrant balloon. The logic runs in the engine; this file
// loads its data, ticks the session on the display clock, paints the picture calls (CMFONT chrome),
// the box fill and opening-frame wipe (raw GPU primitives), and the text, and feeds the confirm key.
// It never executes original instructions and never requests an executable asset.
//
// Drives the UI Lab and the game's ordinary NPC talk route (web/game.js; ?legacyTextbox=1 keeps web/textbox.js).
import { ui } from "./vendor/engine.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { drawNativeTextWidgets } from "./native-screen-text.js";
import { packReady } from "./screenpack.js";
import { loadDialogueFile, loadEsdmgEntry, loadResidentResources } from "./resident-data.js";

const PACK_NAMES = { 0x02860000: "cmfont" };
const packName = (handle) => PACK_NAMES[handle >>> 0] ?? null;
const CONFIRM_BIT = 1 << 13;
/** The game key that drives the confirm bit (Circle). */
const CONFIRM_KEY = "circle";

/**
 * POLY_FT4 fill texture: tpage 0x45 (4-bit, page x 320, y 0), clut 0x2C57, UV 0xBC..0xC7 x 0..0x3E.
 * The 12-wide, 62-high column is CMFONT clip 1 (frame 75; clips 0/1/2 are 16/12/12 wide and
 * sit side by side, so clip 1 starts at texel 0xBC and ends at 0xC7). Clip 1 is never drawn as a
 * sprite: only the fill samples it. Its texels are opaque in the capture (the body shows the
 * texture colour whatever is behind it), so the fill paints it as an opaque stretched image.
 */
const FILL_TEXTURES = new Map([["45:2c57:bc", { pack: "cmfont", sx: 80, sy: 0, sw: 12, sh: 62 }]]);

function paintRaw(ctx, raw, getPack) {
    const { kind, intent } = raw;
    if (kind === "tailLine") {
        const [x0, y0, x1, y1] = intent.points;
        const [r, g, b] = intent.color;
        ctx.save();
        ctx.strokeStyle = `rgb(${r},${g},${b})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x0 + 0.5, y0 + 0.5);
        ctx.lineTo(x1 + 0.5, y1 + 0.5);
        ctx.stroke();
        ctx.restore();
        return true;
    }
    if (kind === "frameFill") {
        const key = `${intent.tpage.toString(16)}:${intent.clut.toString(16)}:${intent.uv[0].toString(16)}`;
        const tex = FILL_TEXTURES.get(key);
        if (!tex) return false;
        const pack = getPack(tex.pack);
        if (!pack || !packReady(pack)) return false;
        const xs = [intent.corners[0], intent.corners[2], intent.corners[4], intent.corners[6]];
        const ys = [intent.corners[1], intent.corners[3], intent.corners[5], intent.corners[7]];
        const x = Math.min(...xs), y = Math.min(...ys);
        const w = Math.max(...xs) - x, h = Math.max(...ys) - y;
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(pack.img, tex.sx, tex.sy, tex.sw, tex.sh, x, y, w, h);
        ctx.restore();
        return true;
    }
    return false;
}

const DATA_LABEL = "Dialogue data";

export function createDialogueTranslated(sfx = null) {
    const g = {
        _open: false, _pending: false, _failed: false, _error: null, _session: null, _clock: null,
        _ticks: 0, _request: 0, _onClose: null, _latched: false, _primed: false, _onFail: null, _packed: {}, _prevHeld: false, _closes: 0, _sounds: [],
    };
    const renderer = createNativeScreenRenderer({ pack: "cmfont", packs: { "646:0": "cmfont" } }, packName, { paintRaw, opaqueClips: true });

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
        console.error("Translated dialogue failed", error);
        // The game route hands a failed line back to the hand-made box (the original close effects still run once).
        const onFail = g._onFail;
        if (onFail) { g._onFail = null; g._open = false; g._onClose = null; ++g._request; onFail(error); }
    }

    /**
     * Open a box. `source`: { file: "estalk00", index } or { esdmg: "esdmg400", entry, index } (raw disc banks) or { pack: Uint8Array, index: 0 }.
     * `mode`: { kind: "talk", npc: {x,y,facing,actorId} } or { kind: "say", plain, balloonMode, actor: {x,y,actorId} }.
     */
    g.open = async (source, mode, onClose = null, project = (x, y) => ({ sx: x, sy: y }), opts = {}) => {
        g._open = true;
        g._pending = true;
        g._failed = false;
        g._error = null;
        g._session = null;
        g._ticks = 0;
        g._packed = {};
        g._prevHeld = false;
        g._onClose = onClose;
        g._onFail = opts.onFail ?? null;
        g._latched = false;
        g._primed = false;
        const request = ++g._request;
        try {
            const [shared, pack] = await Promise.all([loadResidentResources(), source.pack ?? (source.esdmg ? loadEsdmgEntry(source.esdmg, source.entry, DATA_LABEL) : loadDialogueFile(source.file, DATA_LABEL))]);
            if (request !== g._request) return;
            const session = new ui.DialogueSession({ font: shared.font, ranges: shared.ranges }, () => g._finish());
            if (mode.kind === "talk") session.openTalk(pack, source.index, mode.npc, project);
            else session.openSay(pack, source.index, mode.actor ?? null, mode.balloonMode ?? 0, !!mode.plain, project);
            // Player-name control (operand 8): the original reads the NUL-terminated name at 0x80048d88.
            const name = opts.playerNameBytes;
            if (name) {
                for (let i = 0; i < 0x1f; i++) session.mem.write8(0x80048d88 + i, i < name.length ? name[i] : 0);
                session.mem.write8(0x80048d88 + Math.min(name.length, 0x1f), 0);
            }
            g._session = session;
            g._clock = new ui.MenuDisplayClock();
            g._pending = false;
        } catch (error) {
            if (request === g._request) fail(error);
        }
    };

    g.isOpen = () => g._open;
    g.handleKey = () => {};
    /** A confirm press seen between display frames (key edge): applied on the next tick. */
    g.pressConfirm = () => { if (g._open) g._latched = true; };

    g.update = (dt, keys = null) => {
        if (!g._open || g._failed || !g._session) return;
        const held = !!keys && keys.has(CONFIRM_KEY);
        // The press that opened the box is still down: it is not a confirm.
        if (!g._primed) { g._primed = true; g._prevHeld = held; g._latched = false; }
        try {
            for (const _frame of g._clock.advance(dt)) {
                const pressed = (held && !g._prevHeld) || g._latched;
                g._latched = false;
                g._prevHeld = held;
                // Hold this frame's session: its close callback can open the next line at once,
                // which replaces g._session before this frame's sounds are collected.
                const session = g._session;
                session.tick({ pressed: pressed ? CONFIRM_BIT : 0, held: held ? CONFIRM_BIT : 0 });
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
        const { calls, contextMarkers, raw } = g._session.drawIntents();
        ctx.save();
        ctx.scale(s, s);
        renderer.draw(ctx, calls, null, [], contextMarkers, raw);
        g._painted = drawNativeTextWidgets(ctx, g._session.textWidgets(), { revealWindow: true }).texts;
        ctx.restore();
    };

    g._finish = () => {
        if (!g._open) return;
        g._open = false;
        g._pending = false;
        g._closes++;
        ++g._request;
        const cb = g._onClose;
        g._onClose = null;
        cb?.();
    };

    g.close = () => {
        if (!g._open) return;
        g._session?.dispose();
        g._finish();
    };

    g.diagnostics = () => ({
        execution: "translated", open: g._open, pending: g._pending, failed: g._failed, error: g._error?.message ?? null,
        ticks: g._ticks, closes: g._closes, painted: (g._painted ?? []).slice(), packed: { ...g._packed }, sounds: g._sounds.slice(),
        state: g._session?.state?.() ?? null, renderer: renderer.stats,
    });

    return g;
}
