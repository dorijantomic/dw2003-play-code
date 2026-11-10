// The Card Shop as a production native screen (Phase 6.3 group 2 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// The player meets the shipped pro/stcrdshp overlay: the shop's own name and
// BIT, and a three-option menu — "Buy One Card", "Open Booster", "Edit Folder".
// Buying opens the six-card stock set that shop id selects; Edit Folder hands
// off to the folder editor (pro/stcrddek). This module is only the state
// adapter between web/game.js and the screen's RAM contract; the screen itself
// runs through web/native-screen-host.js and engine/native.
//
// Contract (docs/research/ui/stcrdshp-decoded-2026-07-12.md and the overlay's
// own constructor F0x80088CA0):
//   * the shop id the stock is keyed on comes from `ctx+0x2708()` =
//     `0x80048D34 + 0x26D0` = 0x8004B404 — the SAME launcher parameter cell the
//     item shop uses. The stock table is the overlay's own 0x8008CDD4
//     (0xC-byte records, -1 terminated), read by F0x80089160.
//   * the BIT balance is `0x80048D34 + 0x6C`.
//   * card availability is the same pair the album and folder editor seed:
//     per-card copies at `0x80048D34 + 0x3A2` and the ever-obtained flag at
//     `+0x4DF`.
//   * `ctx+0x270C(0x400, ctx+0x2708(1))` on teardown is the Edit Folder
//     hand-off (launcher code 0x400 = pro/stcrddek), surfaced through the host
//     transition hook.
//   * the root object's lifecycle (+0xC) reaching 3 is the player leaving.
//
// The old hand-authored shop (web/cardshop.js) stays as the development
// rollback (?legacyCardShop=1).

import { BOOSTER_ITEM_IDS, seedBoosterStock, commitBoosterStock, SAVE_CARD_MAX, COLLECTION_CAP, MONEY_CAP } from "./vendor/engine.js";
import { createNativeAdapter } from "./native-screen-host.js";
import { cards } from "./cardstate.js";

const MODULE_ID = "pro/stcrdshp";
const SAVE_CONTEXT = 0x80048d34;
/** The launcher parameter cell the screen reads its shop id from. */
const LAUNCHER_CELL = 0x8004b404;
const MONEY = SAVE_CONTEXT + 0x6c;
const CARD_COUNTS = SAVE_CONTEXT + 0x3a2;
const CARD_SEEN = SAVE_CONTEXT + 0x4df;
/** The teardown hand-off code that means "open the folder editor". */
const TRANSITION_FOLDER_EDITOR = 0x400;

export function createCardShopNative(sfx = null) {
    const c = {
        _open: false,
        _pending: false,
        _host: null,
        _state: null,
        _onClose: null,
        _onEditFolder: null,
        _shopId: null,
        _lastDiagnostic: null,
    };

    /** Walker state -> the RAM the screen reads. */
    function seed({ write }) {
        const state = c._state ?? {};
        write(LAUNCHER_CELL, (Number.isInteger(c._shopId) ? c._shopId : 0) >>> 0, 4);
        write(MONEY, (state.bits ?? 0) >>> 0, 4);
        seedBoosterStock(state, BOOSTER_ITEM_IDS, write);
        const col = cards();
        if (!col) return;
        for (const [id, n] of col.owned ?? []) {
            const cardId = Number(id);
            if (Number.isInteger(cardId) && cardId >= 1 && cardId < SAVE_CARD_MAX) {
                write(CARD_COUNTS + cardId, Math.max(0, Math.min(COLLECTION_CAP, Number(n) || 0)), 1);
            }
        }
        for (const id of col.seen ?? []) {
            const cardId = Number(id);
            if (Number.isInteger(cardId) && cardId >= 1 && cardId < SAVE_CARD_MAX) write(CARD_SEEN + cardId, 1, 1);
        }
    }

    /** The screen's writes -> the walker's state. */
    function commit() {
        const host = c._host;
        const state = c._state;
        if (!host || !state) return;
        state.bits = Math.max(0, Math.min(MONEY_CAP, host.read(MONEY, 4) >>> 0));
        commitBoosterStock(state, BOOSTER_ITEM_IDS, (address, size) => host.read(address, size));
        if (typeof localStorage !== "undefined") localStorage.setItem("inventory", JSON.stringify(state.inventory));
        const col = cards();
        if (col?.owned instanceof Map) {
            for (let id = 1; id < SAVE_CARD_MAX; id++) {
                const n = host.read(CARD_COUNTS + id, 1);
                const have = col.owned.get(id) ?? 0;
                if (n !== have) {
                    if (n > 0) col.owned.set(id, n);
                    else col.owned.delete(id);
                }
                if (n > 0) col.seen?.add?.(id);
            }
        }
        if (typeof localStorage !== "undefined") {
            localStorage.setItem("bits", String(state.bits));
        }
    }

    // The walker's call site: open(state, onClose, onEditFolder, shopId).
    c.open = (state = null, onClose = null, onEditFolder = null, shopId = null) => {
        c._state = state ?? c._state ?? null;
        c._onClose = onClose;
        c._onEditFolder = onEditFolder;
        c._shopId = Number.isInteger(shopId) ? shopId : null;
        c._lastDiagnostic = null;
        c._transition = 0;
        c._begin();
    };

    c.isOpen = () => c._open;

    // Input arrives as key events, but the native screen reads the pad service's
    // held word once per frame (state.keys carries every held button).
    c.handleKey = (_k, state) => {
        if (state && !c._state) c._state = state;
    };

    /** Diagnostics for the lab and focused browser checks. */
    c.diagnostics = () => ({
        open: c._open,
        pending: c._pending,
        shopId: c._shopId,
        host: c._host?.state() ?? null,
        lastDiagnostic: c._lastDiagnostic,
    });

    createNativeAdapter({
        owner: c,
        moduleId: MODULE_ID,
        hostOptions: {
            playPackedSound: (id) => { sfx?.playPacked(id); },
            seed,
        },
        commit: (host) => {
            // The Edit Folder option leaves the launcher request behind; read it
            // before teardown and hand off exactly as the walker's launcher does.
            c._transition = host.read(0x8004b3fc, 4) >>> 0;
            commit(); // reads through c._host, so it must run first
        },
        closed: () => {
            const editCb = c._onEditFolder;
            c._onEditFolder = null;
            const cb = c._onClose;
            c._onClose = null;
            if (c._transition === TRANSITION_FOLDER_EDITOR && editCb) editCb();
            else cb?.();
            c._transition = 0;
        },
        label: "native card shop boot failed (manifest/overlay missing)",
    });

    return c;
}
