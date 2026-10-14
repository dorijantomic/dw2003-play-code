// The MEMORY CARD save/load screen as a production native screen (Phase 6.3 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// The player meets the shipped pro/stgmcard overlay: the three-card slot
// chooser, the card-access check, the file card with its name / area / place /
// BIT / party icons / levels / play clock, the overwrite prompt and the
// save/load result window. This module is only the state adapter between
// web/game.js and the screen's RAM contract; the screen itself runs through
// web/native-screen-host.js and engine/native, and its memory-card device is
// web/memcard.js.
//
// Contract (docs/research/ui/stgmcard-decoded-2026-08-05.md and the driver
// F0x80084dcc):
//   * ctx 0x80048d34 = the resident save context. The screen's own object reads
//     its save/load mode from ctx+0x26D0 (bit 31 set = SAVE) as it is
//     CONSTRUCTED, so that word is written through the host's preBoot hook.
//   * ctx+0x70 = the party position map, 0x80049494 + slot*0x3DC = the roster
//     records (web/native-screen.js seedNativeScreenParty).
//   * the screen writes its 0xD4 directory and then its 0x26C4 save image back
//     through the card host; the walker persists its own slot on the image
//     write (web/save.js writeSlot) and hands the image back on load.
//
// The old hand-authored screen (web/save.js) stays as the development rollback
// (?legacySave=1) until this route is accepted; nothing here falls back to it.

import { maskFromButtons, rosterSlotOfCharId, itemCountEntries, writeItemArrays } from "./vendor/engine.js";
import {
    openNativeScreen,
    preloadNativeScreens,
    nativeScreensReady,
} from "./native-screen-host.js";
import { seedNativeScreenParty } from "./native-screen.js";
import { createWalkerMemcard, slotForFile } from "./memcard.js";
import { buildRecord, readSlot, restoreSlotData, writeSlot } from "./save.js";

const MODULE_ID = "pro/stgmcard";
const SAVE = 0x80048d34;
const MONEY = SAVE + 0x6c;
const HELD_BASE = SAVE + 0x7c;
/** ctx+0x26D0: the launcher's mode word; bit 31 = SAVE (else LOAD). */
const MODE_WORD = SAVE + 0x26d0;
const SAVE_MODE_WORD = 0x80000000;
/**
 * ctx+0x26C4: the launcher's code word. The original's save-point events hand
 * `0xC00 | slot` to the launcher (engine/dw3/save-points.ts), and the screen's
 * constructor F0x80087b08 reads the low byte as the save-point index for its
 * `0x8008833C` table. Seeded so the overlay reads the real slot, not 0.
 */
const CODE_WORD = SAVE + 0x26c4;
/** ctx+0x4C / +0x50: the play clock words the screen folds into the record. */
const CLOCK_HM = SAVE + 0x4c;
const CLOCK_S = SAVE + 0x50;
const RECORDS = 0x80049494;
const STRIDE = 0x3dc;
const REC_NAME = 0x08;

export function createSaveNative(sfx = null) {
    const r = {
        _open: false,
        _pending: false,
        _host: null,
        _state: null,
        _mode: "save",
        _opts: {},
        _onClose: null,
        _loadedSlot: null,
        _savedSlot: null,
        _stores: [],
        _reads: [],
        _lastTraps: 0,
        _lastDiagnostic: null,
    };

    /** The walker's three slots in the card host's shape. */
    function cardSlots() {
        return [0, 1, 2].map((i) => {
            const slot = readSlot(i);
            if (!slot?.record) return null;
            return {
                record: slot.record,
                image: Array.isArray(slot.image) ? Uint8Array.from(slot.image) : null,
            };
        });
    }

    /** A card over the walker's slots; a written image is the walker's save. */
    function makeCard() {
        const card = createWalkerMemcard({
            slots: cardSlots,
            onStore: (slot, bytes, kind) => {
                r._stores.push({ slot, kind, len: bytes.length });
                if (kind !== "image") return; // the header is rebuilt from the record
                const opts = { ...(r._opts ?? {}) };
                const seconds = Math.max(0, Math.floor(opts.playSeconds ?? r._state?.playSeconds ?? 0));
                writeSlot(slot, {
                    record: buildRecord(r._state, { ...opts, playSeconds: seconds }),
                    image: bytes,
                    data: null, // snapshotStorage() -- the walker's own state
                    playSeconds: seconds,
                });
                r._savedSlot = slot;
                // The write itself is silent in the overlay: the save states
                // 0x32-0x35 of F0x80084dcc carry no play site (pro/stgmcard.s),
                // and the cues around the write come from the machine itself —
                // the prompt's Circle (0x8004503c) and the result window's
                // dismiss (0x0004001c). The old wiring played "system01" (the
                // pre-2026-07-03i shifted name for 0x8004503c) here; nothing
                // plays it now (audit/sfx-save-pause-vs-decode).
            },
        });
        // A 0x26C4 read is the screen loading that file; remember the slot so the
        // close restores the walker's own state for it.
        const readBlock = card.block.bind(card);
        card.block = (file) => {
            const image = readBlock(file);
            if (image) r._loadedSlot = slotForFile(file);
            return image;
        };
        const readRecord = card.record.bind(card);
        card.record = (file) => {
            r._reads.push({ file, slot: slotForFile(file) });
            return readRecord(file);
        };
        return card;
    }

    /** Runs before the root constructor: the mode word it reads. */
    function preBoot({ write }) {
        write(MODE_WORD, r._mode === "save" ? SAVE_MODE_WORD : 0, 4);
        // The save-point launch code; the title's Continue is plain 0xC00 (load).
        const sp = r._opts?.savePointSlot;
        const code = r._mode === "save" && Number.isInteger(sp) && sp >= 1 ? 0xc00 | (sp & 0xff) : 0xc00;
        write(CODE_WORD, code >>> 0, 4);
    }

    /** Runs after boot: the context the screen's save path builds from. */
    function seed({ write }) {
        const state = r._state ?? {};
        write(MONEY, (state.bits ?? 0) >>> 0, 4);
        // Both item count arrays, all 402 ids, through the shared store: the
        // original's state 0x33 copies the whole 0x26C4-byte block, so every one
        // of these bytes reaches the card. An earlier build wrote only ids < 256
        // and silently dropped every accessory from SniperSuit up.
        writeItemArrays({ write8: (address, value) => write(address, value, 1) },
            itemCountEntries(state), SAVE);
        const seconds = Math.max(0, Math.floor(r._opts?.playSeconds ?? state.playSeconds ?? 0));
        write(CLOCK_HM, ((Math.floor(seconds / 3600) & 0xffff) | ((Math.floor(seconds / 60) % 60) << 16)) >>> 0, 4);
        write(CLOCK_S, seconds % 60, 2);
        const party = Array.isArray(state.party) ? state.party : [];
        const slots = r._opts?.partySlots ?? party.map(id => rosterSlotOfCharId(id) ?? 0xffffffff);
        seedNativeScreenParty({
            positions: [0, 1, 2].map((i) => slots[i] ?? 0xffffffff),
            stats: [0, 1, 2].filter(i => party[i] && slots[i] !== 0xffffffff).map((i) => {
                const st = (state.partyStats ?? [])[i] ?? {};
                return {
                    slot: slots[i] ?? i,
                    level: st.level, tp: st.tp, hp: st.hp, maxHp: st.maxHp,
                    mp: st.mp, maxMp: st.maxMp, exp: st.xp,
                    name: state.digimonNames?.[party[i]] ?? st.name,
                    forms: st,
                };
            }),
        });
        // seedNativeScreenParty writes the record's raw name at +0x08; the save
        // screen's own writer copies ctx+0x54 (the player name) into the record
        // it builds, so that is seeded too.
        const name = String(state.playerName ?? "");
        if (name) {
            const enc = [];
            for (const ch of name) {
                const c = ch.charCodeAt(0);
                if (ch >= "0" && ch <= "9") enc.push(0x04 + (c - 0x30));
                else if (ch >= "A" && ch <= "Z") enc.push(0x0e + (c - 0x41));
                else if (ch >= "a" && ch <= "z") enc.push(0x28 + (c - 0x61));
                else enc.push(0x01, 0x01);
            }
            enc.slice(0, 0x17).forEach((b, i) => write(SAVE + 0x54 + i, b, 1));
            write(SAVE + 0x54 + Math.min(enc.length, 0x17), 0, 1);
        }
    }

    function boot() {
        const host = openNativeScreen(MODULE_ID, {
            preBoot,
            seed,
            memcard: makeCard(),
            playPackedSound: (id) => { sfx?.playPacked(id); },
        });
        if (!host) return false;
        r._host = host;
        return true;
    }

    /**
     * A load swaps the whole persisted state under the running game, so the
     * page is reloaded to rebuild every module from it — the same rule the
     * hand-authored screen uses.
     */
    function finishLoad() {
        if (r._loadedSlot === null) return;
        const slot = r._loadedSlot;
        r._loadedSlot = null;
        restoreSlotData(slot);
        if (typeof localStorage !== "undefined") localStorage.setItem("mcardLastSlot", String(slot));
        if (typeof location !== "undefined") {
            // The page reloads into the loaded slot: the boot skips the language and
            // title screens once (web/game.js "resumeAfterLoad"), as the original goes
            // straight to the field after a load.
            try { sessionStorage.setItem("resumeAfterLoad", "1"); } catch { /* storage blocked */ }
            location.reload();
        }
    }

    r.open = (gameState, mode = "save", onClose = null, opts = {}) => {
        r._open = true;
        r._mode = mode === "load" ? "load" : "save";
        r._state = gameState ?? null;
        r._opts = opts ?? {};
        r._onClose = onClose;
        r._loadedSlot = null;
        r._savedSlot = null;
        r._lastDiagnostic = null;
        preloadNativeScreens().catch((e) => {
            r._lastDiagnostic = `native screen preload failed: ${e?.message ?? e}`;
        });
        if (!boot()) r._pending = true;
    };

    r.isOpen = () => r._open;

    r.handleKey = (_k, state) => {
        if (state && !r._state) r._state = state;
    };

    r.update = (dt) => {
        if (!r._open) return;
        if (r._pending) {
            if (!nativeScreensReady()) {
                preloadNativeScreens().catch(() => {});
                return;
            }
            if (!boot()) {
                r._lastDiagnostic = "native save-screen boot failed (manifest/overlay missing)";
                return;
            }
            r._pending = false;
        }
        const keys = r._state?.keys;
        r._host.setPad(keys ? maskFromButtons(keys) : 0);
        const done = r._host.tick(dt);
        r._lastTraps = r._host.state()?.traps ?? r._lastTraps;
        if (done) r._finish();
    };

    r.draw = (ctx, viewW, viewH) => {
        if (!r._open || !r._host) return;
        r._host.draw(ctx, viewW, viewH);
    };

    r.close = () => {
        if (r._open) r._finish();
    };

    r._finish = () => {
        if (!r._open) return;
        r._open = false;
        r._pending = false;
        const host = r._host;
        r._host = null;
        if (host) {
            // The load restores the walker's own state (and reloads the page), so
            // it owns the exit: the caller's onClose must not also start a game
            // that the reload is about to replace.
            const loaded = r._loadedSlot;
            host.teardown();
            if (loaded !== null) {
                r._loadedSlot = loaded;
                r._onClose = null;
                finishLoad();
                return;
            }
        }
        const cb = r._onClose;
        r._onClose = null;
        cb?.();
    };

    /** Diagnostics for the lab and focused browser checks. */
    r.diagnostics = () => ({
        open: r._open,
        pending: r._pending,
        mode: r._mode,
        savedSlot: r._savedSlot,
        loadedSlot: r._loadedSlot,
        stores: r._stores.slice(-4).map((x) => ({ ...x })),
        reads: r._reads.slice(-6).map((x) => ({ ...x })),
        traps: r._host?.state()?.traps ?? r._lastTraps,
        host: r._host?.state() ?? null,
        lastDiagnostic: r._lastDiagnostic,
    });

    return r;
}
