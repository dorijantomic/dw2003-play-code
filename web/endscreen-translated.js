// Browser adapter for the translated END card (engine/dw3/ui/end-card-session.ts).
//
// The card is the title overlay's "END / DIGIMON WORLD 3" screen: pro/stdwtitl's mode-13 root
// F0x80082E9C -> F0x80082D70 -> F0x80084628, drawn by F0x8008453C. The logic runs in the engine;
// this file loads its one data input (the seven-entry language table in stdwtitl_ui.json), ticks
// the card on the display clock, and paints what the session hands back: the picture calls it
// recorded, which the shared native-screen renderer resolves through the extracted `endall` pack —
// including the fade, because the card's fade IS the picture service's CLUT row offset (the draw
// call's +0x88), not a screen dim. It never executes original instructions and asks for no
// executable asset.
//
// `?legacyEnd=1` keeps web/endscreen.js, the hand-written stand-in this replaces.
//
// What a player sees, and what it means that this is the port and not the stand-in:
//   * the fade takes one step per display tick. The stand-in looped until the level ran out, so a
//     frame that took two display ticks moved the card two steps; this one moves one.
//   * the wait reads the pad every tick, so a button already down when the wait begins ends it at
//     once, where the stand-in wanted a fresh keypress.
//   * all sound stops on the card's first callback (D0x80055C64). The stand-in was silent but
//     never asked, so it was right only because nothing else happened to be playing.
//   * the last callback asks the resident launcher for the first opening movie (0xE01) and parks.
//     The walker ships no FMV for 0xE01 (the same gap as the title's idle-timeout movie), so the
//     request is reported and the screen is closed as it always has; nothing here invents the
//     hand-off.
//
// The background behind the card is the walker's own black, unchanged, and that is a deliberate
// non-decision rather than an omission. The original's screen root asks its display view for the
// rectangle colour (0x1F, 0x1F, 0x1F) where every ordinary menu asks for none, and what that
// reaches the player as is not settled: see the open question in .bunny-scratch/endcard-report.md
// section 5.1 and docs/research/ui/boot-gap-2026-09-02.md row D5. So this file paints the same
// black web/endscreen.js always painted, records the colour the card asked for in diagnostics()
// (viewColour), and asserts nothing about what it should look like.
import { ui } from "./vendor/engine.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { paintNativeSession, updateNativeSession } from "./native-session.js";
import { paletteClipId } from "./screenpack.js";
import { fetchJson } from "./resident-data.js";

/** The framebuffer the card's coordinates are authored in. */
const NATIVE_W = 320;
const NATIVE_H = 240;
/** The `eng` pack the walker ships (./dw3-research languages): language index 2, clip 0, "END". */
const DEFAULT_LANGUAGE = 2;
const DATA_LABEL = "END card data";

let data = null;
let loading = null;

/**
 * Load the card's layout table. Safe to call repeatedly. The session checks the table against the
 * overlay's own seven-word jump table, so drift in the extracted data fails loudly rather than
 * quietly drawing another language's picture.
 */
export async function loadEndCardTranslated() {
    if (data) return data;
    loading ??= fetchJson("stdwtitl_ui.json", DATA_LABEL)
        .then((json) => {
            const end = json.end_screen;
            data = {
                clipByLanguage: end.language_table.clip_by_language,
                clipLabels: end.clip_labels,
                pack: end.pack,
            };
            return data;
        })
        .catch((error) => { loading = null; throw error; });
    return loading;
}

/**
 * The card as web/game.js holds it. The read-only views (state/level/clipId/label/diagnostics)
 * are what the UI lab and tools/verify_endscreen.mjs read, so a capture can be checked without
 * looking at the image.
 */
export function createEndCardTranslated(options = {}) {
    const card = {
        _open: false,
        _session: null,
        _renderer: null,
        _clock: null,
        _data: null,
        _failed: false,
        _error: null,
        _ticks: 0,
        _language: options.language ?? DEFAULT_LANGUAGE,
        /** Keys the card samples every callback, as the engine's button names. */
        _held: [],
        _lastState: null,
        _launches: [],
        _stopSound: options.stopSound ?? null,
        _onDone: options.onDone ?? null,
    };

    function fail(error) {
        card._error = error;
        card._failed = true;
        card._open = false;
        console.error("Translated END card failed", error);
    }

    /** Build the session and raise the card. The original's only entry is title launch mode 13. */
    function startSession() {
        card._session ??= new ui.EndCardSession(card._data, {
            onStopAllSound: () => card._stopSound?.(),
            onLaunch: (code) => card._launches.push(code >>> 0),
        });
        card._renderer ??= createNativeScreenRenderer({ pack: card._data.pack }, () => card._data.pack);
        card._clock = new ui.MenuDisplayClock();
        card._session.begin({ language: card._language });
        card._lastState = null;
        card._launches.length = 0;
        card._ticks = 0;
    }

    card._finish = () => {
        if (!card._open) return;
        card._open = false;
        const done = card._onDone;
        card._onDone = null;
        done?.();
    };

    /**
     * Raise the card; the data arrives before the first tick runs. `onDone` is the caller's close,
     * the same shape web/lab-translated.js's open takes.
     */
    card.open = (onDone = null) => {
        card._failed = false;
        card._error = null;
        card._open = true;
        card._onDone = onDone ?? null;
        // A fresh session per opening, so the shared update loop starts this one.
        card._session = null;
        loadEndCardTranslated().then((loaded) => { card._data = loaded; })
            .catch((error) => { if (card._open) fail(error); });
        return true;
    };

    card.isDone = () => card._failed || !!card._session?.finished();

    /** The pad the card samples every callback, straight from the walker's held set. */
    card.setHeld = (keys) => { card._held = [...keys]; };

    /** Advance by `dt` seconds: one card callback per display tick due, with that tick's delta. */
    card.step = (dt) => {
        updateNativeSession(card, dt, {
            ready: () => card._data, start: startSession, held: () => card._held, fail,
        });
        const state = card._session?.state();
        if (state) card._lastState = state;
    };

    /**
     * Paint the card. The fade is the palette row its own picture call carries, so it arrives as
     * part of the recorded draw rather than as a dim over it; the card has no text widgets (the
     * pack's four pictures carry every word it shows).
     */
    card.draw = (ctx, viewW = NATIVE_W, viewH = NATIVE_H) => {
        const session = card._session;
        if (!card._open || !session || card._failed || !card._renderer) return;
        // The walker's own fill, kept as it is: the background colour the original asks its
        // view for is unresolved (report 5.1 / boot-gap row D5), so nothing here decides it.
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, viewW, viewH);
        const s = viewW / NATIVE_W;
        ctx.save();
        ctx.scale(s, s);
        ctx.imageSmoothingEnabled = false;
        paintNativeSession(ctx, card._renderer, { draw: session.drawIntents(), widgets: session },
            { fade: false });
        ctx.restore();
    };

    /** Drop the card (the lab closed it another way). */
    card.cancel = () => {
        card._open = false;
        card._session?.dispose();
    };

    // ── read-only views, for the lab and the verifier ──────────────────────────

    /** The card object's live state: its own task state, sub-state, level and timer. */
    card.state = () => card._session?.state() ?? card._lastState;

    /** The CLUT level the draw is passing: 15 is invisible, 0 the settled green card. */
    card.level = () => card.state()?.level ?? null;

    card.clip = () => (card._data ? Number(card._data.clipByLanguage[String(card._language)] ?? 0) : 0);

    /** The clip id the extracted sheet carries for the language and the current level. */
    card.clipId = () => {
        const level = card.level();
        return level === null ? null : paletteClipId(card.clip(), level);
    };

    card.label = () => (card._data ? card._data.clipLabels[String(card.clip())] ?? "END" : "END");

    /** The launch codes the card asked the resident launcher for. */
    card.launches = () => [...card._launches];

    card.diagnostics = () => ({
        execution: "translated",
        host: "end-card-session",
        open: card._open,
        active: !!card._session?.isActive(),
        failed: card._failed,
        error: card._error?.message ?? null,
        ticks: card._ticks,
        language: card._language,
        state: card.state(),
        clip: card.clip(),
        label: card.label(),
        clipId: card.clipId(),
        launches: [...card._launches],
        stoppedSound: card._session?.timesStoppedSound?.() ?? 0,
        // The colour the card asked its display view for, and the fill the walker paints.
        // Recorded, not decided: see the header and report 5.1.
        viewColour: card._session?.view?.()?.colour ?? null,
        background: "#000 (the walker's own fill; the original's view colour is unresolved)",
        painted: card._renderer?.stats ?? null,
    });

    return card;
}