// Browser state and painting adapter for the translated registration wizard
// (the Online Center clerk: account name, starter pack, "Register account?").
// The wizard's logic runs in engine/dw3/ui (WizardRootSession); this file loads
// its data, forwards the held buttons, paints the picture calls and text, and
// hands the account name and chosen pack back to the walker's opening. It never
// executes original instructions; `?nativePack=1` keeps the original-code
// screen as a research reference (web/packselect-native.js).
import { ui } from "./vendor/engine.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { paintNativeSession } from "./native-session.js";
import { decodeGameName, encodeGameName } from "./nameentry-translated.js";
import { fetchBytes, fetchJson, loadResidentResources } from "./resident-data.js";

// The picture handles the wizard asks for: the window art, the intro background
// and the portrait / keyboard art.
const PACKS = { 650: "stnmet", 708: "cmnbgd", 1904: "namedt" };
const BANKS = [0x8d, 0x4e, 0x86];
const PRESS_FRAMES = 4;

const DATA_LABEL = "Wizard data";
let sharedPromise = null;
const loadShared = () => {
    sharedPromise ??= Promise.all([
        fetchBytes("wizard/tables.bin", DATA_LABEL), loadResidentResources().then((shared) => shared.font),
        fetchJson("wizard/manifest.json", DATA_LABEL),
    ]).then(([tables, font, manifest]) => ({
        tables, font, members: manifest.starterMembers.bytes,
        cursorGlyphs: manifest.cursorGlyphs, textButtons: manifest.textButtons,
    })).catch((error) => { sharedPromise = null; throw error; });
    return sharedPromise;
};

export function createPackSelectTranslated(sfx = null) {
    const p = {
        _open: false, _done: false, _session: null, _state: null, _clock: null, _error: null,
        _request: 0, _sel: 0, _partners: [], _accountName: "",
        _queue: [], _hold: 0, _press: null,
    };
    const renderer = createNativeScreenRenderer({ pack: "stnmet", packs: PACKS },
        (directory) => PACKS[directory >>> 16] ?? null);

    // The walker's wizard API (web/game.js `state.packSelect`): synthesized presses.
    const queue = (button) => { p._queue.push(button); return true; };
    p.moveUp = () => queue("up");
    p.moveDown = () => queue("down");
    p.confirm = () => queue("circle");
    p.cancel = () => queue("cross");
    p.isOpen = () => p._open;
    p.isDone = () => p._done;
    p.sel = () => p._sel;
    p.pack = () => p._sel;
    p.accountName = () => p._accountName;
    p.partners = () => p._partners.slice();

    p.open = (opts = {}) => {
        p._open = true;
        p._done = false;
        p._sel = 0;
        p._partners = [];
        p._state = opts.state ?? p._state;
        p._accountName = p._state?.playerName ?? "";
        p._queue.length = 0;
        p._hold = 0;
        p._press = null;
        p._error = null;
        p._session = null;
        p._clock = new ui.MenuDisplayClock();
        const request = ++p._request;
        loadShared().then(async (shared) => {
            const selected = p._state?.languageByte;
            const language = Number.isInteger(selected) ? selected : 2;
            if (language < 0 || language > 6) throw new Error("Wizard language index is invalid");
            const banks = new Map(await Promise.all(BANKS.map(async (offset) =>
                [offset + language, await fetchBytes(`wizard/${offset + language}.bin`, DATA_LABEL)])));
            if (!p._open || request !== p._request) return;
            p._session = new ui.WizardRootSession(language,
                encodeGameName(p._accountName, language === 0 ? 5 : 8),
                { ...shared, banks },
                { playSound(id) { sfx?.playPacked(id); } });
        }).catch((error) => {
            if (request !== p._request) return;
            p._error = error;
            console.error("Translated registration wizard failed to open", error);
        });
        return p;
    };

    p.update = (dt, state) => {
        if (state) p._state = state;
        if (!p._open) return;
        if (p._error) { p._finish(); return; }
        if (!p._session) return;
        for (const frame of p._clock.advance(dt)) {
            if (p._hold <= 0 && p._queue.length) {
                p._press = p._queue.shift();
                p._hold = PRESS_FRAMES;
            }
            if (p._hold > 0) p._hold--;
            else p._press = null;
            // A synthesized press wins over the held keys while it lasts, so one
            // key event never counts twice.
            p._session.tick(p._press ? [p._press] : (p._state?.keys ?? []), frame.tick);
            if (p._session.finished()) { p._finish(); break; }
        }
    };
    p.advance = p.update;

    p.draw = (ctx, viewW = 320) => {
        if (!p._open || !p._session) return false;
        ctx.save();
        ctx.scale(viewW / 320, viewW / 320);
        // The wizard's boxes draw through the shared text-element path, so they
        // must paint the element's own reveal window: the intro message is one
        // resource string whose [pause] control codes page it. Without this the
        // painter re-decodes line 0 from the start and stops at the first pause,
        // so "Welcome to Digimon Online." is the only page a player ever sees.
        paintNativeSession(ctx, renderer, p._session, { fade: false, revealWindow: true });
        ctx.restore();
        return true;
    };

    p.close = () => { if (p._open) p._finish(); };

    p._finish = () => {
        if (!p._open) return;
        p._open = false;
        ++p._request;
        const registration = p._session?.registration() ?? null;
        if (registration) {
            p._accountName = decodeGameName(registration.accountName);
            p._sel = registration.pack & 3;
            p._partners = registration.members.slice();
        }
        p._session = null;
        p._done = true;
    };

    p.diagnostics = () => ({
        open: p._open, pending: p._open && !p._session, done: p._done, error: p._error?.message ?? null,
        sel: p._sel, partners: p._partners.slice(), tasks: p._session?.tree.tasks.size ?? 0,
        renderer: renderer.stats,
    });
    return p;
}
