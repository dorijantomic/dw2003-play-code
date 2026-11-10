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

import { SAVE_CARD_MAX } from "./vendor/engine.js";
import { createNativeAdapter } from "./native-screen-host.js";
import { cards } from "./cardstate.js";

const MODULE_ID = "pro/stcrdabm";
const SAVE_CONTEXT = 0x80048d34;
/** The ever-obtained album flag array (one byte per card). */
const CARD_SEEN = SAVE_CONTEXT + 0x4df;

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
            if (Number.isInteger(cardId) && cardId >= 1 && cardId < SAVE_CARD_MAX) {
                write(CARD_SEEN + cardId, 1, 1);
            }
        };
        for (const id of collection.seen ?? []) mark(id);
        for (const [id] of collection.owned ?? []) mark(id);
    }

    // The walker's call site passes only onClose; the lab passes nothing.
    a.open = (stateOrClose = null, onClose = null) => {
        if (typeof stateOrClose === "function") {
            a._onClose = stateOrClose;
        } else {
            a._state = stateOrClose ?? a._state ?? null;
            a._onClose = onClose;
        }
        a._lastDiagnostic = null;
        a._begin();
    };

    a.isOpen = () => a._open;

    // Input arrives as key events, but the native screen reads the pad service's
    // held word once per frame (state.keys carries every held button).
    a.handleKey = (_k, state) => {
        if (state && !a._state) a._state = state;
    };

    /** Diagnostics for the lab and focused browser checks. */
    a.diagnostics = () => ({
        open: a._open,
        pending: a._pending,
        host: a._host?.state() ?? null,
        lastDiagnostic: a._lastDiagnostic,
    });

    return createNativeAdapter({
        owner: a,
        moduleId: MODULE_ID,
        hostOptions: { playPackedSound: (id) => { sfx?.playPacked(id); }, seed },
        label: "native album boot failed (manifest/overlay missing)",
    });
}
