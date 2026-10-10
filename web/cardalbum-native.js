// The Card Album as a production native screen (Phase 6.3 group 2 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// The player meets the shipped pro/stcrdabm overlay: a paged six-column grid
// over the 314-card collection the album addresses (ids 1..314; its loops test
// `id < 0x13B`), each slot showing the card's art and its AP/HP
// when the player owns it, or a placeholder silhouette when they do not.
// L1/R1 turn the page, the d-pad moves the cell, Cross opens the card's detail
// and Triangle leaves. This module is only the state adapter between
// web/game.js and the screen's RAM contract; the screen itself runs through
// web/native-screen-host.js and engine/native.
//
// Contract (docs/research/ui/stcrdabm-decoded-2026-07-12.md and
// engine/dw3/ui/native/album-grid.ts):
//   * the album reads the resident collection table at
//     0x80048d34 + 0x4DF + card — nonzero means the player has ever obtained
//     that card (cards below 0x13B are in range);
//   * the root object's lifecycle (+0xC) reaching 3 is the player leaving
//     (Triangle, "[triangle] Button: Back").
//
// The album is browse-only: it has no commit path, so there is nothing to read
// back. The old hand-authored screen (web/cardalbum.js) stays as the
// development rollback (?legacyAlbum=1).

import { maskFromButtons } from "./vendor/engine.js";
import {
    openNativeScreen,
    preloadNativeScreens,
    nativeScreensReady,
} from "./native-screen-host.js";
import { cards } from "./cardstate.js";

const MODULE_ID = "pro/stcrdabm";
const SAVE_CONTEXT = 0x80048d34;
/** The ever-obtained album flag array (one byte per card). */
const CARD_SEEN = SAVE_CONTEXT + 0x4df;
const CARD_MAX_ID = 0x13b;

export function createCardAlbumNative(sfx = null) {
    const a = {
        _open: false,
        _pending: false,
        _host: null,
        _state: null,
        _onClose: null,
        _lastDiagnostic: null,
    };

    /** Walker collection -> the album's collection table. */
    function seed({ write }) {
        const collection = cards();
        if (!collection) return;
        const mark = (id) => {
            const cardId = Number(id);
            if (Number.isInteger(cardId) && cardId >= 1 && cardId < CARD_MAX_ID) {
                write(CARD_SEEN + cardId, 1, 1);
            }
        };
        for (const id of collection.seen ?? []) mark(id);
        for (const [id] of collection.owned ?? []) mark(id);
    }

    function boot() {
        const host = openNativeScreen(MODULE_ID, {
            playPackedSound: (id) => { sfx?.playPacked(id); },
            seed,
        });
        if (!host) return false;
        a._host = host;
        return true;
    }

    // The walker's call site passes only onClose; the lab passes nothing.
    a.open = (stateOrClose = null, onClose = null) => {
        a._open = true;
        if (typeof stateOrClose === "function") {
            a._onClose = stateOrClose;
        } else {
            a._state = stateOrClose ?? a._state ?? null;
            a._onClose = onClose;
        }
        a._lastDiagnostic = null;
        preloadNativeScreens().catch((e) => {
            a._lastDiagnostic = `native screen preload failed: ${e?.message ?? e}`;
        });
        if (!boot()) a._pending = true;
    };

    a.isOpen = () => a._open;

    // Input arrives as key events, but the native screen reads the pad service's
    // held word once per frame (state.keys carries every held button).
    a.handleKey = (_k, state) => {
        if (state && !a._state) a._state = state;
    };

    a.update = (dt) => {
        if (!a._open) return;
        if (a._pending) {
            if (!nativeScreensReady()) {
                preloadNativeScreens().catch(() => {});
                return;
            }
            if (!boot()) {
                a._lastDiagnostic = "native album boot failed (manifest/overlay missing)";
                return;
            }
            a._pending = false;
        }
        const keys = a._state?.keys;
        a._host.setPad(keys ? maskFromButtons(keys) : 0);
        if (a._host.tick(dt)) a._finish();
    };

    a.draw = (ctx, viewW, viewH) => {
        if (!a._open || !a._host) return;
        a._host.draw(ctx, viewW, viewH);
    };

    a.close = () => {
        if (a._open) a._finish();
    };

    a._finish = () => {
        if (!a._open) return;
        a._open = false;
        a._pending = false;
        if (a._host) a._host.teardown();
        a._host = null;
        const cb = a._onClose;
        a._onClose = null;
        cb?.();
    };

    /** Diagnostics for the lab and focused browser checks. */
    a.diagnostics = () => ({
        open: a._open,
        pending: a._pending,
        host: a._host?.state() ?? null,
        lastDiagnostic: a._lastDiagnostic,
    });

    return a;
}
