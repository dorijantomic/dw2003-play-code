// Browser adapter for the translated stage-entry location title card
// (engine/dw3/ui/place-card-session.ts). The logic runs in the engine; this file loads its data
// (the fieldstg name table and bar templates, the area/place text banks for all seven languages,
// the UI font), runs one card callback per display tick, and paints what the session hands back:
// the bar quads in the order the GPU paints them, then the two names, both inside the slit.
// It never executes original instructions.
//
// Same API as web/placecard.js (createPlaceCard / loadPlaceCard), so game.js can swap the factory
// in one line. The walker map id becomes the card's scene id through place_card.json, which
// carries the scene of every shipped map.
//
// Timing: web/inn-translated.js's display clock (ui.MenuDisplayClock). Each tick it yields is
// one card callback with that tick's frame delta, and every due tick runs: there is no catch-up
// cap, because the original has none.
import { ui } from "./vendor/engine.js";
import { drawNativeTextWidgets } from "./native-screen-text.js";
import { fetchBytes, fetchJson, loadResidentResources } from "./resident-data.js";

/** The framebuffer the card's coordinates are authored in. */
const NATIVE_W = 320;
const DEFAULT_LANGUAGE = 2;

const DATA_LABEL = "Place card data";

let data = null;
let loading = null;

/** Load the name table, bar templates, every language's two banks and the font. Safe to call repeatedly. */
export async function loadPlaceCardTranslated() {
    if (data) return data;
    loading ??= (async () => {
        const [{ font }, nameTable, barTemplates, json] = await Promise.all([
            loadResidentResources(), fetchBytes("place-banks/name-table.bin", DATA_LABEL),
            fetchBytes("place-banks/bar-templates.bin", DATA_LABEL),
            fetchJson("place_card.json", DATA_LABEL),
        ]);
        const banks = [];
        for (let lang = 0; lang < 7; lang++) {
            const ids = ui.placeCardBankIds(lang);
            banks.push(Promise.all([fetchBytes(`place-banks/${ids.area}.bin`, DATA_LABEL), fetchBytes(`place-banks/${ids.place}.bin`, DATA_LABEL)]));
        }
        data = { font, nameTable, barTemplates, stages: json.stages, banks: await Promise.all(banks) };
        return data;
    })().catch((error) => { loading = null; throw error; });
    return loading;
}

/** The scene id the shipped table gives a walker map id, or null. */
export function placeCardScene(mapId) {
    return data?.stages?.[mapId]?.scene ?? null;
}

export function createPlaceCardTranslated() {
    const card = {
        _session: null,
        _clock: null,
        /** Set while the walker is still getting the stage on screen (the field is not ready). */
        _held: false,
        _failed: false,
        _error: null,
        _language: DEFAULT_LANGUAGE,
        _ticks: 0,
        _painted: [],
    };

    function fail(error) {
        card._error = error;
        card._failed = true;
        console.error("Translated place card failed", error);
    }

    /** The language byte [0x8005CCA8] the next card reads its banks with (0..6). */
    card.setLanguage = (language) => {
        if (Number.isInteger(language) && language >= 0 && language <= 6) card._language = language;
    };

    card.isActive = () => !!card._session?.isActive() && !card._failed;

    /** The field's busy flag: raised on begin, cleared by the card's last callback. */
    card.isBusy = () => !!card._session?.busy();

    /**
     * Start the card for an arrival. Returns false, and shows nothing, when the data is not
     * loaded or the map has no scene id in the shipped table (no shipped map lacks one).
     */
    card.begin = (mapId) => {
        const scene = placeCardScene(mapId);
        card._session?.dispose();
        if (!data || scene == null) return false;
        try {
            card._session ??= new ui.PlaceCardSession(data);
            const [areaBank, placeBank] = data.banks[card._language];
            card._session.begin({ scene, language: card._language, areaBank, placeBank });
            card._clock = new ui.MenuDisplayClock();
            card._held = false;
            card._failed = false;
            card._error = null;
            card._ticks = 0;
        } catch (error) {
            fail(error);
            return false;
        }
        return true;
    };

    card.cancel = () => {
        card._session?.dispose();
    };

    /**
     * Hold the finished card on screen. The original's release is the field's stage-entry
     * sequence finishing (F0x8008AA10); this is the walker's hook for it.
     */
    card.hold = (on) => {
        card._held = !!on;
    };

    /** Advance by `dt` seconds: one card callback per display tick due. */
    card.step = (dt) => {
        const session = card._session;
        if (!session?.isActive() || card._failed) return;
        try {
            for (const frame of card._clock.advance(dt)) {
                session.tick(!card._held);
                card._ticks++;
                if (!session.isActive()) break;
            }
        } catch (error) {
            fail(error);
        }
    };

    card.draw = (ctx, viewW, viewH) => {
        const session = card._session;
        if (!session?.isActive() || card._failed) return;
        const s = viewW / NATIVE_W;
        const slit = session.slit();
        ctx.save();
        ctx.beginPath();
        ctx.rect(slit.x * s, slit.y * s, slit.w * s, slit.h * s);
        ctx.clip();
        ctx.scale(s, s);
        ctx.imageSmoothingEnabled = false;
        // Paint order: the GPU walks the bar entry from its head, so the first quad is the bottom one.
        for (const q of session.drawIntents()) {
            if (!q.w || !q.h) continue;
            ctx.fillStyle = `rgb(${q.colour[0]},${q.colour[1]},${q.colour[2]})`;
            ctx.fillRect(q.x, q.y, q.w, q.h);
        }
        // The names sit in ordering-table entry 0, the bars in entry 1: the names paint over them.
        card._painted = drawNativeTextWidgets(ctx, session.textWidgets(), { revealWindow: true }).texts;
        ctx.restore();
    };

    /** Live state, for tests and the UI lab (the fields web/placecard.js's verifier reads). */
    card.state = () => {
        const st = card._session?.state();
        if (!st) return null;
        const name = (n) => ({ revealed: n?.revealed ?? 0, total: n?.total ?? 0, ended: !!n?.ended });
        return {
            phase: st.state, step: st.step, hold: st.hold, released: st.released, busy: st.busy,
            area: name(st.names[0]), place: name(st.names[1]),
            bars: st.bars, clip: card._session.slit(),
        };
    };

    card.diagnostics = () => ({
        execution: "translated", active: card.isActive(), failed: card._failed,
        error: card._error?.message ?? null, ticks: card._ticks, held: card._held,
        language: card._language, painted: card._painted.slice(), state: card.state(),
    });

    return card;
}
