// The naming screen as a production native screen (Phase 6.3 group 3 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// The player meets this screen when renaming a Digimon at the DRI desk. The
// opening's account name belongs to the registration wizard in
// web/packselect-native.js. This module is the state adapter between web/game.js and the
// screen's RAM contract; the screen itself runs through web/native-screen-host.js
// and engine/native.
//
// Contract (research answer stdgname-commit-and-close, accepted 2026-09-22, and
// the measurements in .dw3-research/autonomous-plan/phase6-route-inventory.md):
//   * The screen has a player-gated pre-screen: F0x80085B70 waits for pad port 0
//     logical 0xD (Circle, confirm) or 0xE (Cross, cancel). Circle creates the
//     keyboard grid (cb 0x80085078); Cross sets root+0x60 = -1 and fades out.
//   * The typed name lives in the grid at +0x78 as `unk94` (8, or 5 in the JPN
//     branch) u16 glyph ids, blank = 0x4081. The screen seeds that from the
//     roster record's name field, which holds the game's own BYTE encoding
//     (web/native-screen.js encodeNativeScreenText): the record base for party
//     slot s is 0x8004949C + s*0x3DC, reached by ctx+0x2750(ctx+0x2718(pairId)).
//   * OK is action-table index 33 (cell 103). Its arm scans the grid for a
//     non-blank slot: accepted sets grid+0x10 = 0x64, refused (all blank) sets
//     0x14 and shows "That name is not allowed.".
//   * On accept the sequence's state 3 calls the export F0x80085258(grid, dst),
//     which converts the glyphs back to the byte encoding and writes the trimmed
//     name into the SAME record field, then F0x80085358 sets grid+0x10 = 0xA and
//     the grid's lifecycle reaches 3. Measured: writing grid+0x78[0] = 0x7982
//     ('Z') and running the export put byte 0x27 ('Z') at the record.
//   * Only the pre-screen cancel path sets the root's lifecycle 3; on accept the
//     overlay's own teardown is the caller's, so this adapter closes when the
//     grid finishes and supplies the hand-off.
//
// The hand-authored keyboard (web/nameentry.js) stays as the development
// rollback (?legacyName=1).

import { maskFromButtons, ROSTER_SLOT_CHARIDS } from "./vendor/engine.js";
import {
    openNativeScreen,
    preloadNativeScreens,
    nativeScreensReady,
} from "./native-screen-host.js";
import { nativeScreenObjects, nativeScreenRead, seedNativeScreenParty } from "./native-screen.js";
import { driStatsAt } from "./dri-model.js";
import { ensureStoredStats } from "./battle.js";

const MODULE_ID = "pro/stdgname";
const GRID_CB = 0x80085078;
const ROOT_CB = 0x8008645c;
/** The roster record the screen names: base 0x8004949C, stride 0x3DC, name at +0. */
const RECORD_BASE = 0x8004949c;
const RECORD_STRIDE = 0x3dc;
const NAME_MAX_BYTES = 16;
const PARTY_MAP = 0x80048d34 + 0x70;
const PARTY_SLOTS = 3;
const LANGUAGE_INDEX = 0x8005cca8;

/** Roster slot for a manifest party char id, or -1 when it is not a roster
 *  species (same convention as web/gym-native.js and web/dri-native.js). */
function rosterSlotFor(charId) {
    const i = ROSTER_SLOT_CHARIDS.indexOf(String(charId));
    return i < 0 ? 0xffffffff : i;
}

/** The game's own byte encoding back to text (inverse of encodeNativeScreenText
 *  in web/native-screen.js): 0x04..0x0D digits, 0x0E..0x27 A-Z, 0x28..0x51 a-z,
 *  NUL-terminated. */
export function decodeNativeName(bytes) {
    let out = "";
    for (const b of bytes) {
        if (b === 0) break;
        if (b >= 0x04 && b <= 0x0d) out += String.fromCharCode(0x30 + (b - 0x04));
        else if (b >= 0x0e && b <= 0x27) out += String.fromCharCode(0x41 + (b - 0x0e));
        else if (b >= 0x28 && b <= 0x51) out += String.fromCharCode(0x61 + (b - 0x28));
        else out += " ";
    }
    return out.trim();
}

export function createNameEntryNative(sfx = null, tables = null) {
    const n = {
        _open: false,
        _pending: false,
        _host: null,
        _state: null,
        _initial: "",
        _targetSlot: null,
        _seededPositions: null,
        _onDone: null,
        _sawGrid: false,
        _lastResult: null,
        _lastDiagnostic: null,
    };

    /** Walker state -> the RAM the screen reads. */
    function seed({ write }) {
        const state = n._state ?? {};
        // The opening's starter naming runs BEFORE the granted pack becomes
        // state.party: packSelectDone stores it in state.pendingParty, and the
        // s212 download assigns state.party later. Without this fallback the
        // screen's partner pre-screen has no member to name and the export writes
        // nothing (measured: playerName came back empty on the opening hand-off).
        const live = Array.isArray(state.party) ? state.party : [];
        const pending = Array.isArray(state.pendingParty) ? state.pendingParty : [];
        const party = live.length ? live : pending;
        const positions = [];
        const stats = [];
        for (let i = 0; i < PARTY_SLOTS; i++) {
            if (i >= party.length) {
                positions.push(0xffffffff);
                continue;
            }
            const slot = rosterSlotFor(party[i]);
            positions.push(slot);
            if (slot === 0xffffffff) continue;
            // The opening names a starter BEFORE any stats exist (the granted
            // pack lives in state.pendingParty until the s212 download), so the
            // stats lookup is best-effort: the screen only needs the slot and the
            // name to seed its grid, and the rest of the fields are cosmetic.
            let ps = {};
            try { ps = driStatsAt(state, i, tables?.digimonById ?? {}) ?? {}; } catch { ps = {}; }
            const profile = tables?.digimonById?.[ps.digimonId ?? 0];
            const core = profile ? ensureStoredStats(ps, profile) : (ps.stats ?? {});
            stats.push({
                slot,
                // The name the screen seeds its grid from: the walker's stored
                // name for this member, else the profile's.
                name: state.digimonNames?.[party[i]] ?? profile?.name ?? ps.name ?? "",
                level: Number(ps.level) || 1,
                tp: Number(ps.tp) || 0,
                hp: Number(ps.hp) || 0,
                maxHp: Number(ps.maxHp) || 0,
                mp: Number(ps.mp) || 0,
                maxMp: Number(ps.maxMp) || 0,
                exp: Number(ps.xp) || 0,
                core: [Number(core?.str) || 0, Number(core?.def) || 0, Number(core?.spr) || 0, Number(core?.wis) || 0, Number(core?.spd) || 0, Number(core?.chr) || 0],
            });
        }
        seedNativeScreenParty({ positions, stats });
        n._seededPositions = positions.slice();
        // The pre-screen's Circle copies [0x80087F3C] into the root; that cell is
        // the pair id (0 = the lead), which is what the DRI rename and the
        // starter naming both name.
        write(0x80087f3c, 0, 4);
        // The adapter may also be given an explicit target (a reserve member), in
        // which case its slot goes in the same party-map cell the screen reads.
        if (Number.isInteger(n._targetSlot)) {
            const idx = positions.indexOf(n._targetSlot);
            if (idx > 0) write(0x80087f3c, idx, 4);
        }
    }

    function boot() {
        const host = openNativeScreen(MODULE_ID, {
            playPackedSound: (id) => { sfx?.playPacked(id); },
            seed,
        });
        if (!host) return false;
        n._host = host;
        n._sawGrid = false;
        return true;
    }

    /** The screen's own close: the pre-screen cancel sets the root's lifecycle 3,
     *  the accept path finishes the grid (which the host then destroys). */
    function namingFinished() {
        const objs = nativeScreenObjects();
        const root = objs.find((o) => (o.cb >>> 0) === ROOT_CB);
        if (!root || (nativeScreenRead(root.addr + 0xc, 4) | 0) === 3) return true;
        const grid = objs.find((o) => (o.cb >>> 0) === GRID_CB);
        if (grid) {
            n._sawGrid = true;
            return (nativeScreenRead(grid.addr + 0xc, 4) | 0) === 3;
        }
        // The grid existed and is gone: the accept path finished it and the host
        // destroyed it, which is the commit.
        return n._sawGrid;
    }

    /** The committed name: the record field the export wrote. */
    function selectedSlot() {
        const host = n._host;
        if (!host) return null;
        // The screen names the PAIR stored at 0x80087F3C — the pre-screen's own
        // selection, which the player can move across a multi-member party. Read
        // that cell back so a party larger than one names the record the screen
        // actually wrote (measured: with three pending members and no explicit
        // target the lead-only read came back empty).
        let slot = Number.isInteger(n._targetSlot) ? n._targetSlot : null;
        if (slot === null) {
            const pair = host.read(0x80087f3c, 4) | 0;
            const seeded = n._seededPositions ?? [];
            if (pair >= 0 && pair < seeded.length) slot = seeded[pair];
            if (!Number.isInteger(slot) || slot < 0) slot = readSlotForLead(host);
        }
        return Number.isInteger(slot) && slot >= 0 ? slot : null;
    }

    function committedName(slot) {
        const host = n._host;
        if (!host || slot === null) return n._initial;
        const bytes = [];
        for (let i = 0; i < NAME_MAX_BYTES; i++) bytes.push(host.read(RECORD_BASE + slot * RECORD_STRIDE + i, 1) & 0xff);
        const name = decodeNativeName(bytes);
        return name || n._initial;
    }

    function readSlotForLead(host) {
        const state = n._state;
        const party = Array.isArray(state?.party) ? state.party : [];
        if (!party.length) return null;
        return rosterSlotFor(party[0]);
    }

    // The walker's call site: open({ initial, onDone }).
    n.open = (opts = {}) => {
        n._open = true;
        n._initial = typeof opts.initial === "string" ? opts.initial : "";
        n._targetSlot = Number.isInteger(opts.slot) ? opts.slot : null;
        n._onDone = typeof opts.onDone === "function" ? opts.onDone : null;
        n._state = opts.state ?? n._state;
        n._lastResult = null;
        n._lastValue = n._initial;
        n._lastDiagnostic = null;
        preloadNativeScreens().catch((e) => {
            n._lastDiagnostic = `native screen preload failed: ${e?.message ?? e}`;
        });
        if (!boot()) n._pending = true;
    };

    n.isOpen = () => n._open;
    n.isDone = () => !n._open;
    /** The screen's accepted result, including the member the player chose. */
    n.result = () => n._lastResult;

    // Input arrives as key events, but the native screen reads the pad service's
    // held word once per frame (state.keys carries every held button). The
    // legacy method names stay as no-ops so the shared key path cannot throw.
    n.handleKey = (_k, state) => {
        if (state) n._state = state;
    };
    n.moveUp = () => {};
    // Read-only introspection the shared focused checks use to follow the
    // cursor; the native grid holds it at +0x9C (col) / +0xA0 (row).
    const gridState = () => {
        const g = nativeScreenObjects().find((o) => (o.cb >>> 0) === GRID_CB);
        if (!g) return null;
        return { row: nativeScreenRead(g.addr + 0xa0, 4) | 0, col: nativeScreenRead(g.addr + 0x9c, 4) | 0 };
    };
    n.cursor = () => gridState() ?? { row: 0, col: 0 };
    /** The cursor cell in the shape the shared focused checks expect: the action
     *  keys are the right-hand block (col >= 10, row >= 3) — DEL row 4, SPC row
     *  5, the arrow keys row 6 cols 10..12, OK row 6 cols 13..14. */
    n.currentCell = () => {
        const c = gridState();
        if (!c) return null;
        const act = c.col >= 10 && c.row === 4 ? "DEL"
            : c.col >= 10 && c.row === 5 ? "SPC"
                : c.row === 6 && c.col === 10 ? "LEFT"
                    : c.row === 6 && c.col >= 11 && c.col <= 12 ? "RIGHT"
                        : c.row === 6 && c.col >= 13 ? "OK" : null;
        return { row: c.row, col: c.col, act };
    };
    /** How many name slots hold a character (blanks are the 0x4081 sentinel). */
    n.typedLength = () => {
        const g = nativeScreenObjects().find((o) => (o.cb >>> 0) === GRID_CB);
        if (!g) return 0;
        const limit = nativeScreenRead(g.addr + 0x94, 4) | 0;
        let n2 = 0;
        for (let i = 0; i < limit; i++) if ((nativeScreenRead(g.addr + 0x78 + i * 2, 2) | 0) !== 0x4081) n2++;
        return n2;
    };
    n.isClosing = () => false;
    n.fadeLevel = () => 0;
    n.slots = () => [];
    n.moveDown = () => {};
    n.moveLeft = () => {};
    n.moveRight = () => {};
    n.press = () => {};
    n.selectDel = () => {};
    n.selectEnd = () => {};

    n.update = (dt, state) => {
        if (state) n._state = state;
        if (!n._open) return;
        if (n._pending) {
            if (!nativeScreensReady()) {
                preloadNativeScreens().catch(() => {});
                return;
            }
            if (!boot()) {
                n._lastDiagnostic = "native naming boot failed (manifest/overlay missing)";
                return;
            }
            n._pending = false;
        }
        const keys = n._state?.keys;
        n._host.setPad(keys ? maskFromButtons(keys) : 0);
        const hostFinished = n._host.tick(dt);
        if (namingFinished() || hostFinished) n._finish();
    };
    n.advance = n.update;

    n.draw = (ctx, viewW, viewH) => {
        if (!n._open || !n._host) return;
        n._host.draw(ctx, viewW, viewH);
    };

    /** The name the screen currently shows: the live grid while it is up, the
     *  committed name after it closes, else the seed. */
    n.value = () => {
        const g = nativeScreenObjects().find((o) => (o.cb >>> 0) === GRID_CB);
        if (g && n._host) {
            const bytes = [];
            for (let i = 0; i < NAME_MAX_BYTES; i++) bytes.push(n._host.read(g.addr + 0x78 + i, 1) & 0xff);
            // grid+0x78 is u16 glyphs; the live name is the record's byte field.
            const slot = n._targetSlot ?? readSlotForLead(n._host);
            if (Number.isInteger(slot) && slot >= 0) {
                const rec = [];
                for (let i = 0; i < NAME_MAX_BYTES; i++) rec.push(n._host.read(RECORD_BASE + slot * RECORD_STRIDE + i, 1) & 0xff);
                const live = decodeNativeName(rec);
                if (live) return live;
            }
        }
        return n._lastValue ?? n._initial;
    };
    n.close = () => {
        if (n._open) n._finish(false);
    };

    n._finish = (allowCommit = true) => {
        if (!n._open) return;
        n._open = false;
        n._pending = false;
        const host = n._host;
        if (host) {
            // Read the selected pair and committed record while RAM is alive.
            const slot = selectedSlot();
            const party = Array.isArray(n._state?.party) && n._state.party.length
                ? n._state.party : (n._state?.pendingParty ?? []);
            const memberId = slot === null ? null : party.find((id) => rosterSlotFor(id) === slot) ?? null;
            const accepted = allowCommit && n._sawGrid && slot !== null && memberId !== null;
            n._lastValue = accepted ? committedName(slot) : n._initial;
            n._lastResult = { accepted, memberId: accepted ? memberId : null, value: n._lastValue };
            host.teardown();
        } else {
            n._lastResult = { accepted: false, memberId: null, value: n._initial };
        }
        n._host = null;
        const cb = n._onDone;
        n._onDone = null;
        cb?.(n._lastValue);
    };

    /** Diagnostics for the lab and focused browser checks. */
    n.diagnostics = () => ({
        open: n._open,
        pending: n._pending,
        initial: n._initial,
        value: n._lastValue ?? null,
        host: n._host?.state() ?? null,
        lastDiagnostic: n._lastDiagnostic,
    });

    return n;
}
