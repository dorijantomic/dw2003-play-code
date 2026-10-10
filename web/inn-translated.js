// Browser adapter for the translated inn rest screen (engine/dw3/ui/inn-session.ts). The logic runs in
// the engine; this file loads its data (the eshtlnam bank, the UI font, the cursor glyphs), ticks the
// session on the display clock, turns the walker's button calls into the pressed pad word, paints the
// CMFONT window clips, the text and the rest fade, and plays the packed sounds. It never executes
// original instructions.
//
// Same API as web/inn.js (createInn), so game.js can swap the factory in one line.
//
// The rest itself (F0x8001104C: full HP/MP for party slots 0..2) is applied here through restAtInn when
// the session calls onRest; the screen has already charged the BIT, which is read back from it.
//
// Sound: 0x4004000D is JINGLE04, a common-bank exclusive-register sound (bit 30), and the id the
// screen saves from 0x80055C34 and replays is whatever held that register
// (docs/research/audio/sound-system.md, "The exclusive-track register"). Neither is the SEQ music, so
// both go through sfx.playPacked and the bgm track is left playing.
import { innForStage, quoteInnStay, restAtInn, ui } from "./vendor/engine.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { drawNativeTextWidgets } from "./native-screen-text.js";
import { applyInnRest } from "./inn.js";
import { fetchBytes, loadResidentResources } from "./resident-data.js";

const PACK_NAMES = { 0x02860000: "cmfont" };
const packName = (handle) => PACK_NAMES[handle >>> 0] ?? null;

const DATA_LABEL = "Inn data";

const bankCache = new Map();
const loadBank = (language) => {
    const id = ui.innBankId(language);
    if (!bankCache.has(id)) bankCache.set(id, fetchBytes(`inn-banks/${id}.bin`, DATA_LABEL).catch((e) => { bankCache.delete(id); throw e; }));
    return bankCache.get(id);
};

// The deployed partner blocks, as web/inn.js prices them: index 0 is partnerStats, the rest partyStats.
function partyOf(state) {
    const chars = state?.party;
    if (!Array.isArray(chars) || !chars.length) return [];
    const stats = Array.isArray(state.partyStats) ? state.partyStats : [];
    return chars.map((_, i) => (i === 0 ? state.partnerStats : stats[i]) ?? {});
}

export function createInnTranslated(sfx = null, bgm = null) {
    const inn = {
        _open: false, _failed: false, _error: null, _session: null, _clock: null, _state: null, _record: null,
        _party: [], _onClose: null, _queued: 0, _ticks: 0, _closes: 0, _sounds: [], _music: [], _request: 0,
        _bgm: bgm, time: 0,
    };
    const renderer = createNativeScreenRenderer({ pack: "cmfont", packs: { "646:0": "cmfont" } }, packName);

    const playSound = (id) => {
        const key = id >>> 0;
        inn._sounds.push(key);
        if (inn._sounds.length > 256) inn._sounds.splice(0, inn._sounds.length - 256);
        sfx?.playPacked?.(key);
    };

    function fail(error) {
        inn._error = error;
        inn._failed = true;
        console.error("Translated inn failed", error);
    }

    inn.isOpen = () => inn._open;
    /** Selected row: 0 = Stay in Inn, 1 = Do not stay in Inn. */
    inn.selection = () => inn._session?.state()?.selection ?? 0;

    inn.load = async () => {
        const shared = await loadResidentResources();
        renderer.ready();
        return shared;
    };

    function language(state) {
        const selected = state?.languageByte;
        return Number.isInteger(selected) && selected >= 0 && selected <= 6 ? selected : 2;
    }

    /** The rest effect: BIT already charged by the screen; heal slots 0..2 and persist. */
    function rest(session) {
        const state = inn._state;
        if (!state) return;
        const before = Number(state.bits ?? 0);
        const result = restAtInn(inn._party, inn._record.pricePerDigimon, before);
        state.bits = session.bits();
        if (result.rested) applyInnRest(state, inn._party, result.party);
        if (typeof localStorage !== "undefined") {
            localStorage.setItem("bits", String(state.bits));
            localStorage.setItem("partnerStats", JSON.stringify(state.partnerStats));
            localStorage.setItem("partyStats", JSON.stringify(state.partyStats ?? []));
        }
    }

    /**
     * @param state  game state (bits, party, partnerStats/partyStats, languageByte)
     * @param opts   { map, onClose } — `map` is the scene the player stands on ("s235" or 235).
     * @returns the quote, or null when that map has no inn.
     */
    inn.open = async (state, opts = {}) => {
        const record = innForStage(opts.map);
        if (!record) return null;
        const request = ++inn._request;
        const party = opts.party ?? partyOf(state);
        const quote = quoteInnStay(party, record.pricePerDigimon, state?.bits ?? 0);
        // The screen is UP from the moment it is asked for, not from the moment
        // its bank has finished loading. That is the contract every other translated
        // adapter keeps — web/shop-translated.js:93 sets `_open` before its first
        // await, web/dialogue-translated.js:94 and web/help-menu-translated.js:50 the
        // same, and each bumps `_request` on the way out (web/shop-translated.js:141,
        // web/dialogue-translated.js:174, web/help-menu-translated.js:122). This
        // adapter set `_open` only after its await, so a close() that landed while the
        // bank was still loading was swallowed: `finish()` saw a closed screen and
        // returned, and the open then went on to raise a rest screen the caller had
        // already dismissed. That is how a stay ended up alive underneath the memory
        // card, taking the card's own confirm as a second "Stay in Inn"
        // (tools/verify_inn_rest.mjs, "the card did not charge the stay a second
        // time").
        inn._open = true;
        try {
            const lang = language(state);
            const [shared, bank] = await Promise.all([loadResidentResources(), loadBank(lang)]);
            if (request !== inn._request) return quote;
            inn._session?.dispose();
            const session = new ui.InnSession(shared);
            inn._state = state;
            inn._record = record;
            inn._party = party;
            inn._onClose = opts.onClose ?? null;
            inn._queued = 0;
            inn._ticks = 0;
            inn._music = [];
            inn._failed = false;
            inn._error = null;
            inn.time = 0;
            session.open({
                inn: record, partyCount: Math.min(3, party.length), bits: Number(state?.bits ?? 0) | 0,
                language: lang, bank, exclusiveSound: sfx?.exclusiveId?.() ?? 0,
            }, {
                onRest: () => rest(session),
                onMusic: (id, kind) => inn._music.push([id >>> 0, kind]),
                onClose: () => finish(),
            });
            inn._session = session;
            inn._clock = new ui.MenuDisplayClock();
        } catch (error) {
            if (request === inn._request) { inn._open = false; fail(error); }
            return null;
        }
        return quote;
    };

    // Both close paths bump `_request`, so an open() whose bank has not finished loading
    // is discarded instead of raising the screen after the caller dismissed it — the same
    // contract as web/dialogue-translated.js:166-177 and web/help-menu-translated.js:117-133.
    function finish() {
        if (!inn._open) return;
        inn._open = false;
        inn._closes++;
        ++inn._request;
        const cb = inn._onClose;
        inn._onClose = null;
        cb?.();
    }

    /** Abandon the screen (the field left another way); onClose still runs, as web/inn.js close() does. */
    inn.close = () => {
        inn._session?.dispose();
        finish();
    };

    // Button calls become the pressed word of the next display tick (logical bits: Up 4, Down 6,
    // Confirm 13, Cancel 14). The screen reads Up/Down from the pressed or repeat word.
    inn.moveUp = () => { inn._queued |= ui.INN_PAD_UP; };
    inn.moveDown = () => { inn._queued |= ui.INN_PAD_DOWN; };
    inn.confirm = () => { inn._queued |= ui.INN_PAD_CONFIRM; };
    inn.cancel = () => { inn._queued |= ui.INN_PAD_CANCEL; };

    inn.tick = (dt) => {
        if (!inn._open || inn._failed || !inn._session) return;
        inn.time += dt;
        try {
            for (const frame of inn._clock.advance(dt)) {
                const session = inn._session;
                const pressed = inn._queued;
                inn._queued = 0;
                session.tick({ pressed, repeat: 0 }, frame.tick);
                inn._ticks++;
                for (const id of session.takeSounds()) playSound(id);
                if (!session.isOpen() || inn._session !== session) return;
            }
        } catch (error) {
            fail(error);
        }
    };

    // Screen space: call after ctx.restore(), same contract as web/inn.js.
    inn.draw = (ctx, viewW = 320, viewH = 240) => {
        if (!inn._open || !inn._session) return;
        const s = Math.max(1, Math.min(viewW / 320, viewH / 240));
        const { calls, contextMarkers } = inn._session.drawIntents();
        ctx.save();
        ctx.scale(s, s);
        renderer.draw(ctx, calls, null, [], contextMarkers, []);
        inn._painted = drawNativeTextWidgets(ctx, inn._session.textWidgets()).texts;
        ctx.restore();
        drawFade(ctx, inn._session.fadeIntent(), viewW, viewH);
    };

    // F0x80011E74: a flat (L, L, L) quad over the whole display with blend mode 2, background minus
    // foreground: every channel loses L, clamped at 0. Canvas has no subtract mode, so it is built
    // exactly from difference and add: 255 - min(255, (255 - dst) + L) = max(0, dst - L).
    // GUESS: the quad sits over the inn windows (it is in the same layer at depth 0, the windows at 1).
    function drawFade(ctx, fade, viewW, viewH) {
        if (!fade || fade.level <= 0) return;
        const L = fade.level & 0xff;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const w = ctx.canvas?.width ?? viewW, h = ctx.canvas?.height ?? viewH;
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "difference";
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = `rgb(${L},${L},${L})`;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = "difference";
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
    }

    inn.diagnostics = () => ({
        execution: "translated", open: inn._open, failed: inn._failed, error: inn._error?.message ?? null,
        inn: inn._record ? { stage: inn._record.stage, name: inn._record.name, price: inn._record.pricePerDigimon } : null,
        ticks: inn._ticks, closes: inn._closes, sounds: inn._sounds.slice(), music: inn._music.slice(),
        painted: (inn._painted ?? []).slice(), state: inn._session?.state?.() ?? null,
        fade: inn._session?.fadeIntent?.() ?? null, rests: inn._session?.rests ?? 0, renderer: renderer.stats,
    });

    return inn;
}
