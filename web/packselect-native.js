// The starter-pack wizard as a production native screen (Phase 6.3 group 3 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// The player meets the shipped pro/stplnmet overlay in the opening: the Online
// Center registration wizard types an account name on the same keyboard the
// naming screen uses, picks starter pack A/B/C, and answers "Register account?"
// YES/NO. This module is only the adapter between the walker's opening hand-off
// (web/game.js `state.packSelect`) and the screen's RAM contract; the screen
// itself runs through web/native-screen-host.js and engine/native.
//
// Contract (research answer stplnmet-contract, accepted 2026-09-22):
//   * Root tick F0x80088138 (cb 0x80088138); sequence F0x80087C9C; three steps:
//     name keyboard -> pack list -> "Register account?".
//   * The commit is sequence selector 3 (stplnmet.s L5335-L5358): the name is
//     written to 0x80048D88 (ctx+0x54, the registered-name buffer), the pack id
//     to the u32 0x8004B374, and the pack's three roster slots to
//     0x80048DA4/DA8/DAC (ctx+0x70/74/78) from the membership table
//     0x8004B490 (pack*3+i) — 0 = {0,6,7}, 1 = {2,3,6}, 2 = {1,5,7}, which is
//     exactly the walker's PACKS order (web/packs.js). It also marks
//     roster_owned[slot] = slot + 3.
//   * Close: that same store sets the root's +0xC = 3; the next root tick posts
//     0x2D8 to 0x8004B3FC (F0x80016B88(0x2D8, 0)).
//   * Seeding: the language index (2 shipped), the registered-name buffer
//     0x80048D88 (the screen copies it into the keyboard at create), and the
//     party map 0x80048D34+0x70/74/78 = -1 (the screen's own initialiser does
//     this on console). Packs and the initial selection are static: pack A and
//     YES are pre-selected, so no pack list seeding is needed.
//
// The walker's own wizard (web/stplnmet.js) stays as the development rollback
// (?legacyPack=1).

import { maskFromButtons } from "./vendor/engine.js";
import {
    openNativeScreen,
    preloadNativeScreens,
    nativeScreensReady,
} from "./native-screen-host.js";
import { encodeNativeScreenText, nativeScreenObjects, nativeScreenRead } from "./native-screen.js";
import { decodeNativeText } from "./native-screen-text.js";

const MODULE_ID = "pro/stplnmet";
const ROOT_CB = 0x80088138;
/** ctx+0x54: the registered-name buffer the wizard's commit writes. */
const REGISTERED_NAME = 0x80048d34 + 0x54;
/** The starter-pack id u32 (claim DIGI-Q001-PACK-ID-001, verified). */
const PACK_ID = 0x8004b374;
/** ctx+0x70/74/78: the three starter roster slots. */
const PARTY_MAP = 0x80048d34 + 0x70;
/** The scene-transition request the close posts. */
const LAUNCH_KIND = 0x8004b3fc;
// Eight field cells can each export a two-byte glyph, plus the terminator.
const NAME_BYTES = 8 * 2 + 1;

const PAD_UP = 0x0010;      // logical 4
const PAD_DOWN = 0x0040;    // logical 6
const PAD_CIRCLE = 0x2000;  // logical 0xD
const PAD_CROSS = 0x4000;   // logical 0xE
const PRESS_FRAMES = 4;

export function createPackSelectNative(sfx = null) {
    const p = {
        _open: false,
        _pending: false,
        _host: null,
        _state: null,
        _done: false,
        _sel: 0,
        _partners: [],
        _accountName: "",
        _queue: [],
        _hold: 0,
        _mask: 0,
        _lastTraps: 0,
        _lastDiagnostic: null,
    };

    /** Walker state -> the RAM the screen reads. */
    function seed({ write }) {
        const state = p._state ?? {};
        // The screen's own initialiser fills the registered-name buffer from
        // ESNAMEDT and clears the party map; a host boot skips it, so seed both.
        const bytes = encodeNativeScreenText(state.playerName ?? "", NAME_BYTES);
        for (let i = 0; i < NAME_BYTES; i++) write(REGISTERED_NAME + i, bytes[i] ?? 0, 1);
        write(REGISTERED_NAME + bytes.length, 0, 1);
        for (let i = 0; i < 3; i++) write(PARTY_MAP + i * 4, 0xffffffff, 4);
    }

    function boot() {
        const host = openNativeScreen(MODULE_ID, {
            playPackedSound: (id) => { sfx?.playPacked(id); },
            seed,
        });
        if (!host) return false;
        p._host = host;
        return true;
    }

    /** Queue one synthesised pad press (the walker's wizard input is edge-based). */
    function press(mask) {
        p._queue.push(mask);
        return true;
    }

    // The walker's wizard API (web/game.js `state.packSelect`).
    p.moveUp = () => press(PAD_UP);
    p.moveDown = () => press(PAD_DOWN);
    p.confirm = () => press(PAD_CIRCLE);
    p.cancel = () => press(PAD_CROSS);
    p.isOpen = () => p._open;
    p.isDone = () => p._done;
    p.sel = () => p._sel;
    p.pack = () => p._sel;
    p.accountName = () => {
        const host = p._host;
        if (!host) return p._accountName;
        const bytes = [];
        for (let i = 0; i < NAME_BYTES; i++) {
            const b = host.read(REGISTERED_NAME + i, 1) & 0xff;
            if (b === 0) break;
            bytes.push(b);
        }
        return decodeNativeText(bytes).text;
    };
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
        p._mask = 0;
        preloadNativeScreens().catch((e) => {
            p._lastDiagnostic = `native screen preload failed: ${e?.message ?? e}`;
        });
        if (!boot()) p._pending = true;
        return p;
    };

    /** The screen's close: the commit store sets the root's lifecycle to 3. */
    function packClosed() {
        const root = nativeScreenObjects().find((o) => (o.cb >>> 0) === ROOT_CB);
        if (!root) return true;
        return (nativeScreenRead(root.addr + 0xc, 4) | 0) === 3;
    }

    p.update = (dt, state) => {
        if (state) p._state = state;
        if (!p._open) return;
        if (p._pending) {
            if (!nativeScreensReady()) {
                preloadNativeScreens().catch(() => {});
                return;
            }
            if (!boot()) {
                p._lastDiagnostic = "native pack wizard boot failed (manifest/overlay missing)";
                return;
            }
            p._pending = false;
        }
        if (p._hold <= 0 && p._queue.length) {
            p._mask = p._queue.shift();
            p._hold = PRESS_FRAMES;
        }
        if (p._hold > 0) p._hold--;
        else p._mask = 0;
        const keys = p._state?.keys;
        p._host.setPad(p._mask || (keys ? maskFromButtons(keys) : 0));
        const closed = p._host.tick(dt) || packClosed();
        p._lastTraps = p._host.state()?.traps ?? p._lastTraps;
        if (closed) p._finish();
    };
    p.advance = p.update;

    p.draw = (ctx, viewW, viewH) => {
        if (!p._open || !p._host) return false;
        p._host.draw(ctx, viewW, viewH);
        return true;
    };

    p.close = () => {
        if (p._open) p._finish();
    };

    p._finish = () => {
        if (!p._open) return;
        p._open = false;
        const host = p._host;
        if (host) {
            p._accountName = p.accountName();
            // The commit ran in the same tick the root's lifecycle turned 3, so
            // these cells are final before teardown.
            p._sel = (host.read(PACK_ID, 4) >>> 0) & 3;
            const partners = [];
            for (let i = 0; i < 3; i++) partners.push(host.read(PARTY_MAP + i * 4, 4) | 0);
            p._partners = partners;
            host.teardown();
        }
        p._host = null;
        p._done = true;
    };

    /** Diagnostics for the lab and focused browser checks. */
    p.diagnostics = () => ({
        open: p._open,
        pending: p._pending,
        done: p._done,
        sel: p._sel,
        partners: p._partners.slice(),
        packId: p._host ? "0x" + (p._host.read(PACK_ID, 4) >>> 0).toString(16) : null,
        launchKind: p._host ? "0x" + (p._host.read(LAUNCH_KIND, 4) >>> 0).toString(16) : null,
        host: p._host?.state() ?? null,
        traps: p._host?.state()?.traps ?? p._lastTraps,
        lastDiagnostic: p._lastDiagnostic,
    });

    return p;
}
