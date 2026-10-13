// The card duel as a production native screen (Phase 6.3 group 2 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// The player meets the shipped pro/cardgame overlay: the duel board with both
// sides' HP, the hand, the Fortune Gate and the program effects. This module is
// only the state adapter between web/game.js and the screen's RAM contract; the
// screen itself runs through web/native-screen-host.js and engine/native.
//
// Contract (docs/research/card/CARD-DUEL-VERIFIED.md §8-§10 and the overlay's
// own root tick F0x80095BFC):
//   * the opponent the duel loads is the packed argument the LAUNCHER left in
//     `ctx+0x26D0` = 0x8004B404 — the same cell the item shop and card shop use
//     for their own parameter. The root tick's first pass calls
//     `F0x800A3240([0x8004B43C]())`, and [0x8004B43C] is "return ctx+0x26D0", so
//     the duel object's +0x2E8 IS that value. It is a ONE-BASED CARD_NPC.BIN
//     record (170 opponents, stride 0xD0, resource bank 0x7A4).
//   * the player's deck is the folder records at 0x8004935C + folder*0x66:
//     a 10-byte name at +0 and 40 u16 1-based card ids at +0x16.
//   * card availability is the same pair the album/folder editor seed: copies
//     at ctx+0x3A2, ever-obtained at ctx+0x4DF.
//   * the duel result is 0x80048AC0 (s32, 1 = the player won) and the win
//     counter the duel banks.
//   * the root's lifecycle reaching 3 is the player leaving the duel.
//
// The old hand-authored duel (web/cardduel.js) stays as the development
// rollback (?legacyDuel=1).

import { BOOSTER_ITEM_IDS, seedBoosterStock, commitBoosterStock, maskFromButtons } from "./vendor/engine.js";
import {
    openNativeScreen,
    preloadNativeScreens,
    nativeScreensReady,
} from "./native-screen-host.js";
import { encodeNativeScreenText, nativeScreenObjects, nativeScreenRead } from "./native-screen.js";
import { cards } from "./cardstate.js";
import { emit as emitGameEvent } from "./gameEvents.js";

const MODULE_ID = "pro/cardgame";
/** The duel's root tick F0x80095BFC (cardgame.s 0x00012f4c). */
const ROOT_CB = 0x80095bfc;
/** The duel scene object the root creates and waits on (F0x800A3240). */
const DUEL_CB = 0x800a2f00;
const SAVE_CONTEXT = 0x80048d34;
/** The launcher parameter cell the root tick reads the opponent index from. */
const LAUNCHER_CELL = 0x8004b404;
const DUEL_WON = 0x80048ac0;
const MONEY = SAVE_CONTEXT + 0x6c;
const CARD_COUNTS = SAVE_CONTEXT + 0x3a2;
const CARD_SEEN = SAVE_CONTEXT + 0x4df;
const FOLDER_BASE = 0x8004935c;
const FOLDER_STRIDE = 0x66;
const FOLDER_COUNT = 3;
const CARDS_OFF = 0x16;
const CARDS_PER_FOLDER = 40;
const CARD_MAX_ID = 0x13b;
const CARD_COPIES_MAX = 9;

/** The duel's close signal. Unlike the shop and report roots, this one never
 *  sets its lifecycle to 3: F0x80095BFC's state 2 (cardgame.s 0x00013100) runs
 *  the close tail once — launch_stage through ctx+0x270C, then the object's
 *  +0x3C — and parks at +0xC = 2 / +0x10 = 1. So the screen is over when the
 *  root's state word reads 2. The root's state 1 is the wait for the duel's own
 *  end sub-step (duel+0x303 == 2), so state 2 cannot be reached mid-duel. */
function duelScreenClosed() {
    const root = nativeScreenObjects().find((o) => (o.cb >>> 0) === ROOT_CB);
    if (!root) return true;
    return (nativeScreenRead(root.addr + 0xc, 4) | 0) === 2;
}

export function createCardDuelNative(sfx = null, bgm = null, opts = {}) {
    const d = {
        _open: false,
        _pending: false,
        _host: null,
        _state: null,
        _getState: typeof opts.getState === "function" ? opts.getState : null,
        _onClose: null,
        _opponentId: null,
        _lastDiagnostic: null,
    };

    /** Walker state -> the RAM the screen reads. */
    function seed({ write }) {
        const state = d._state ?? {};
        write(LAUNCHER_CELL, (Number.isInteger(d._opponentId) ? d._opponentId : 1) >>> 0, 4);
        write(MONEY, (state.bits ?? 0) >>> 0, 4);
        write(DUEL_WON, 0, 4);
        seedBoosterStock(state, BOOSTER_ITEM_IDS, write);
        const col = cards();
        if (col) {
            for (const [id, n] of col.owned ?? []) {
                const cardId = Number(id);
                if (Number.isInteger(cardId) && cardId >= 1 && cardId < CARD_MAX_ID) {
                    write(CARD_COUNTS + cardId, Math.max(0, Math.min(CARD_COPIES_MAX, Number(n) || 0)), 1);
                }
            }
            for (const id of col.seen ?? []) {
                const cardId = Number(id);
                if (Number.isInteger(cardId) && cardId >= 1 && cardId < CARD_MAX_ID) write(CARD_SEEN + cardId, 1, 1);
            }
            // The deck the duel plays: the three folder records. The name is
            // the folder's own stored name, blank until the player names one —
            // never a default (the original's chooser shows the blank record).
            const folders = Array.isArray(col.folders) ? col.folders : [];
            for (let f = 0; f < FOLDER_COUNT; f++) {
                const rec = FOLDER_BASE + f * FOLDER_STRIDE;
                const folder = folders[f];
                const nameBytes = encodeNativeScreenText(folder?.name ?? "", 10);
                for (let i = 0; i < 10; i++) write(rec + i, nameBytes[i] ?? 0, 1);
                const list = Array.isArray(folder?.cards) ? folder.cards : [];
                for (let i = 0; i < CARDS_PER_FOLDER; i++) {
                    write(rec + CARDS_OFF + i * 2, (Number(list[i]) || 0) & 0xffff, 2);
                }
            }
        }
    }

    function boot() {
        const host = openNativeScreen(MODULE_ID, {
            playPackedSound: (id) => { sfx?.playPacked(id); },
            seed,
        });
        if (!host) return false;
        d._host = host;
        return true;
    }

    /** The duel's result -> the walker's state. */
    function commit() {
        const host = d._host;
        const state = d._state;
        if (!host || !state) return;
        const won = (host.read(DUEL_WON, 4) >>> 0) === 1;
        commitBoosterStock(state, BOOSTER_ITEM_IDS, (address, size) => host.read(address, size));
        if (typeof localStorage !== "undefined") localStorage.setItem("inventory", JSON.stringify(state.inventory));
        state.duelWon = won;
        emitGameEvent("cardDuelEnded", { won, opponentId: d._opponentId ?? null });   // optional layers (extra quests) hear it
        // The screen's own win count for this opponent: the scene's end arm adds
        // one to the byte at 0x80048D34 + duel+0x2EC + 0x7C (capped at 99) on a
        // win and leaves it alone on a loss (cardgame.s 0x000204e0-0x00020504).
        // Read it while the screen's RAM is still alive — _finish calls this
        // before host.teardown().
        const duel = nativeScreenObjects().find((o) => (o.cb >>> 0) === DUEL_CB);
        if (duel) {
            const counterOff = host.read(duel.addr + 0x2ec, 4) >>> 0;
            const counter = host.read(SAVE_CONTEXT + counterOff + 0x7c, 1) >>> 0;
            const key = String(d._opponentId ?? 0);
            state.duelWinCounts = { ...(state.duelWinCounts ?? {}), [key]: counter };
            if (typeof localStorage !== "undefined") {
                localStorage.setItem("duelWinCounts", JSON.stringify(state.duelWinCounts));
            }
        }
        if (typeof localStorage !== "undefined") localStorage.setItem("bits", String(state.bits ?? 0));
    }

    // The walker's call site: open(onClose, opponentName, opponentDeck, opponentId, state).
    // `state` is the walker state this adapter seeds from — the wallet, the 35 booster
    // counts and the folder records — and it must be BOUND before seed() runs, because
    // seed() runs synchronously inside boot(), which open() calls immediately: no key
    // event has been routed yet, so handleKey is too late to be the first binding. Every
    // other adapter that seeds from the walker state binds it in open()
    // (cardshop, dri, fightreport, gym, nameentry, packselect, save, shop, status), and
    // this one additionally takes the walker's own accessor as `opts.getState`, so the
    // debug/tool callers that open a duel through `window.__cardDuel.open(onClose, name,
    // deck, id)` seed a real bag too instead of throwing inside `heldCount`. The last
    // argument keeps the legacy rollback's four positional parameters untouched.
    d.open = (onClose = null, _opponentName = null, _opponentDeck = null, opponentId = null, state = null) => {
        d._open = true;
        d._onClose = typeof onClose === "function" ? onClose : null;
        d._opponentId = Number.isInteger(opponentId) ? opponentId : null;
        d._state = state ?? d._state ?? d._getState?.() ?? null;
        d._lastDiagnostic = null;
        preloadNativeScreens().catch((e) => {
            d._lastDiagnostic = `native screen preload failed: ${e?.message ?? e}`;
        });
        if (!boot()) d._pending = true;
    };

    d.isOpen = () => d._open;

    // Input arrives as key events, but the native screen reads the pad service's
    // held word once per frame (state.keys carries every held button).
    d.handleKey = (_k, state) => {
        if (state && !d._state) d._state = state;
    };

    d.update = (dt) => {
        if (!d._open) return;
        if (d._pending) {
            if (!nativeScreensReady()) {
                preloadNativeScreens().catch(() => {});
                return;
            }
            if (!boot()) {
                d._lastDiagnostic = "native duel boot failed (manifest/overlay missing)";
                return;
            }
            d._pending = false;
        }
        const keys = d._state?.keys;
        d._host.setPad(keys ? maskFromButtons(keys) : 0);
        if (d._host.tick(dt) || duelScreenClosed()) d._finish();
    };

    d.draw = (ctx, viewW, viewH) => {
        if (!d._open || !d._host) return;
        d._host.draw(ctx, viewW, viewH);
    };

    d.close = () => {
        if (d._open) d._finish();
    };

    d._finish = () => {
        if (!d._open) return;
        d._open = false;
        d._pending = false;
        const host = d._host;
        if (host) {
            commit(); // reads through d._host, so it must run first
            host.teardown();
        }
        d._host = null;
        const cb = d._onClose;
        d._onClose = null;
        cb?.();
    };

    /** Diagnostics for the lab and focused browser checks. */
    d.diagnostics = () => ({
        open: d._open,
        pending: d._pending,
        opponentId: d._opponentId,
        host: d._host?.state() ?? null,
        lastDiagnostic: d._lastDiagnostic,
    });

    return d;
}
