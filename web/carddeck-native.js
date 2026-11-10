// The Card Folder editor as a production native screen (Phase 6.3 group 2 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// The player meets the shipped pro/stcrddek overlay: "Choose a folder." over
// three folders, each shown as its name plus six colour counters; Cross opens
// the Edit Folder / Change name submenu; Edit Folder shows the chosen folder's
// forty slots and lets the player swap cards in, and Change name hands the
// folder's own name field to the shared keyboard. Triangle leaves. This module
// is only the state adapter between web/game.js and the screen's RAM contract;
// the screen itself runs through web/native-screen-host.js and engine/native.
//
// Contract (docs/research/ui/card-folder-editor-2026-08-14.md,
// docs/research/card/CARD-DUEL-VERIFIED.md §8 and the stcrddek reader):
//   * the three folder records live at 0x8004935C + folder*0x66:
//       +0x00  10 bytes  the folder name in the game's own glyph encoding
//       +0x16  40 u16    1-based card ids, slot order
//     (0x16 + 40*2 = 0x66, the record stride);
//   * the editor's card availability comes from the same collection arrays the
//     album uses: per-card copies at 0x80048d34 + 0x3A2 and the ever-obtained
//     flag at 0x80048d34 + 0x4DF;
//   * the root object's lifecycle (+0xC) reaching 3 is the player leaving.
//
// The old hand-authored editor (web/carddeck.js) stays as the development
// rollback (?legacyDeck=1).

import { SAVE_CARD_MAX, COLLECTION_CAP } from "./vendor/engine.js";
import { createNativeAdapter } from "./native-screen-host.js";
import { encodeNativeScreenText } from "./native-screen.js";
import { decodeNativeText } from "./native-screen-text.js";
import { cards } from "./cardstate.js";

const MODULE_ID = "pro/stcrddek";
const SAVE_CONTEXT = 0x80048d34;
const FOLDER_BASE = 0x8004935c;
const FOLDER_STRIDE = 0x66;
const FOLDER_COUNT = 3;
const NAME_OFF = 0x00;
const NAME_MAX = 10;
const CARDS_OFF = 0x16;
const CARDS_PER_FOLDER = 40;
const CARD_COUNTS = SAVE_CONTEXT + 0x3a2;
const CARD_SEEN = SAVE_CONTEXT + 0x4df;

export function createCardDeckNative(sfx = null) {
    const d = {
        _open: false,
        _pending: false,
        _host: null,
        _state: null,
        _onClose: null,
        _lastDiagnostic: null,
    };

    /** Walker collection -> the RAM the screen reads. */
    function seed({ write }) {
        const col = cards();
        if (!col) return;
        // Card availability (the same arrays the album seeds).
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
        // The three folder records. A folder is blank until the player names
        // it — the original's new game zero-fills the name field and only the
        // naming screen writes it — so never substitute a default name here.
        const folders = Array.isArray(col.folders) ? col.folders : [];
        for (let f = 0; f < FOLDER_COUNT; f++) {
            const rec = FOLDER_BASE + f * FOLDER_STRIDE;
            const folder = folders[f];
            const nameBytes = encodeNativeScreenText(folder?.name ?? "", NAME_MAX);
            for (let i = 0; i < NAME_MAX; i++) write(rec + NAME_OFF + i, nameBytes[i] ?? 0, 1);
            const list = Array.isArray(folder?.cards) ? folder.cards : [];
            for (let i = 0; i < CARDS_PER_FOLDER; i++) {
                write(rec + CARDS_OFF + i * 2, (Number(list[i]) || 0) & 0xffff, 2);
            }
        }
    }

    // The walker's call site passes only onClose; the lab passes state.
    d.open = (stateOrClose = null, onClose = null) => {
        if (typeof stateOrClose === "function") {
            d._onClose = stateOrClose;
        } else {
            d._state = stateOrClose ?? d._state ?? null;
            d._onClose = onClose;
        }
        d._lastDiagnostic = null;
        d._begin();
    };

    /** The screen's folder records -> the walker's collection. */
    function commit(host) {
        const col = cards();
        if (!host || !col || !Array.isArray(col.folders)) return;
        for (let f = 0; f < FOLDER_COUNT; f++) {
            const folder = col.folders[f];
            if (!folder) continue;
            const rec = FOLDER_BASE + f * FOLDER_STRIDE;
            const bytes = [];
            for (let i = 0; i < NAME_MAX; i++) {
                const b = host.read(rec + NAME_OFF + i, 1);
                if (b === 0) break;
                bytes.push(b);
            }
            const name = (decodeNativeText(bytes)?.text ?? "").trim();
            if (name) folder.name = name;
            const list = [];
            for (let i = 0; i < CARDS_PER_FOLDER; i++) {
                const id = host.read(rec + CARDS_OFF + i * 2, 2) & 0xffff;
                list.push(id);
            }
            folder.cards = list;
        }
        col.activeFolder = 0;
        if (typeof localStorage !== "undefined") {
            try { localStorage.setItem("cardCollection", JSON.stringify({
                owned: [...(col.owned ?? new Map()).entries()],
                seen: [...(col.seen ?? new Set())],
                folders: col.folders,
                activeFolder: col.activeFolder ?? 0,
                packs: [...(col.packs ?? new Map()).entries()],
            })); } catch { /* storage full: the live object still carries the edit */ }
        }
    }

    d.isOpen = () => d._open;

    // Input arrives as key events, but the native screen reads the pad service's
    // held word once per frame (state.keys carries every held button).
    d.handleKey = (_k, state) => {
        if (state && !d._state) d._state = state;
    };

    /** Diagnostics for the lab and focused browser checks. */
    d.diagnostics = () => ({
        open: d._open,
        pending: d._pending,
        host: d._host?.state() ?? null,
        lastDiagnostic: d._lastDiagnostic,
    });

    return createNativeAdapter({
        owner: d,
        moduleId: MODULE_ID,
        hostOptions: { playPackedSound: (id) => { sfx?.playPacked(id); }, seed },
        commit,
        label: "native folder editor boot failed (manifest/overlay missing)",
    });
}
