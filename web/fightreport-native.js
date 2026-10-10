// The post-fight results screen as a production native screen (Phase 6.3 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// The player meets the shipped pro/stfgtrep overlay: up to three partner rows
// slide in, each with a name, level, stats and an experience number that counts
// up; the screen pays the battle's BIT and item, and shows level-ups and new
// forms. This module is only the state adapter between web/game.js and the
// screen's RAM contract; the screen itself runs through
// web/native-screen-host.js and engine/native.
//
// Contract (docs/research/overlays/stfgtrep.md, docs/research/ui/
// fight-report-layout.md and the battle overlay wfightmn's writers):
//   * 0x80042b84 = the report workspace the battle overlay fills:
//       +0x00 u16  battle id (index into the overlay's own reward table
//                  0x80086a88, 0xC-byte records [dvexp, exp, bits]);
//       +0x02 u16  dropped item id (0 = none);
//       +0x04 u32  the party position the BIT payout goes to;
//       +0x06 + pos*4  u8 participated flag;
//       +0x07 + pos*4 + v (v<3)  u8 form/stat flag.
//     Writers: F0x800a7c00 (battle id + active position), F0x800a69f0 /
//     F0x800a6b18 (participant and form flags). Reader: F0x800857f0.
//   * 0x80048d34 + 0x70 = the party position map (position -> roster slot);
//     ctx+0x2718/ctx+0x2750 resolve a position to its roster record.
//   * 0x80049494 + slot*0x3DC = the roster record: +0x20 EXP, +0x24 level,
//     +0x26 TP, +0x28/+0x2A HP, +0x2C/+0x2E MP, +0x30 six core stats,
//     +0x3C seven element points, +0x3C8/+0x3CA accessories.
//   * the root object's lifecycle (+0xC) reaching 3 is the player leaving.
//
// The screen pays the BIT (state 0x14, capped 9,999,999) and the dropped item
// (state 0x15, capped 99); the walker reads both back on close. Experience and
// level-ups are applied by the walker's own decoded reward maths (web/battle.js
// winRewards/applyParticipantProgress), so the roster is seeded with the
// PRE-battle experience and the count-up lands on the walker's total.
//
// The old hand-authored screen (web/fightreport.js) stays as the development
// rollback until this route is accepted; nothing here falls back to it.

import {
    heldCount, itemCountEntries, maskFromButtons, readHeldByte, setHeldCount, writeItemArrays,
} from "./vendor/engine.js";
import { seedNativeScreenParty } from "./native-screen.js";
import {
    openNativeScreen,
    preloadNativeScreens,
    nativeScreensReady,
} from "./native-screen-host.js";
import { fitNativeScreen } from "./canvas-resolution.js";

const MODULE_ID = "pro/stfgtrep";
/** The manifest's census constructor; the root_ctor field is a sub-object. */
const ROOT_CTOR = 0x80085b24;

const SAVE = 0x80048d34;
const MONEY = SAVE + 0x6c;
const PARTY = SAVE + 0x70;
const WORKSPACE = 0x80042b84;
const WS_BATTLE_ID = 0x00;
const WS_ITEM_ID = 0x02;
const WS_ACTIVE_POS = 0x04;
const WS_FLAG_BASE = 0x06;
const WS_FORM_BASE = 0x07;

const RECORDS = 0x80049494;
const STRIDE = 0x3dc;
const REC = {
    exp: 0x20, level: 0x24, tp: 0x26, hp: 0x28, maxHp: 0x2a,
    mp: 0x2c, maxMp: 0x2e, core: 0x30, elements: 0x3c,
    acc0: 0x3c8, acc1: 0x3ca,
};
const CORE = ["str", "def", "spt", "wis", "spd", "chr"];
const ELEMENTS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"];
const BIT_CAP = 0x98967f; // 9,999,999
const PARTY_SLOTS = 3;

export function createFightReportNative(sfx = null) {
    const r = {
        _open: false,
        _pending: false,
        _host: null,
        _state: null,
        _onClose: null,
        _seed: null,
        _lastDiagnostic: null,
    };

    /** Walker state -> the RAM the screen reads. */
    function seed({ write }) {
        const s = r._seed ?? {};
        const state = r._state ?? {};
        seedNativeScreenParty({
            positions: s.partySlots,
            stats: (s.participants ?? []).map(p => ({
                slot: p.rosterSlot, name: p.name, forms: p.forms,
                level: p.level, exp: p.preExp,
            })),
        });
        // Party map + roster records.
        for (let i = 0; i < PARTY_SLOTS; i++) {
            const slot = s.partySlots?.[i];
            write(PARTY + i * 4, slot == null ? 0xffffffff : slot >>> 0, 4);
        }
        for (const p of s.participants ?? []) {
            const base = RECORDS + (p.rosterSlot ?? 0) * STRIDE;
            write(base + REC.exp, (p.preExp ?? 0) >>> 0, 4);
            if (p.level != null) write(base + REC.level, p.level & 0xffff, 2);
            (p.core ?? []).forEach((v, j) => write(base + REC.core + j * 2, v & 0xffff, 2));
            (p.elements ?? []).forEach((v, j) => write(base + REC.elements + j * 2, v & 0xffff, 2));
            if (p.acc0 != null) write(base + REC.acc0, p.acc0 & 0xffff, 2);
            if (p.acc1 != null) write(base + REC.acc1, p.acc1 & 0xffff, 2);
        }
        // Money + bag counts the screen reads for its payout checks.
        write(MONEY, (state.bits ?? 0) >>> 0, 4);
        // Both item count arrays, all 402 ids. The payout (case 0x15) reads
        // ctx+0x7C+id with the FULL id, so an id in the 256..402 band is a real
        // byte; the earlier `id < 256` filter left it at whatever RAM held, and a
        // drop of such an item overwrote the carried count instead of adding to it.
        writeItemArrays({ write8: (address, value) => write(address, value, 1) },
            itemCountEntries(state), SAVE);
        // The report workspace.
        write(WORKSPACE + WS_BATTLE_ID, (s.battleId ?? 0) & 0xffff, 2);
        write(WORKSPACE + WS_ITEM_ID, (s.dropItemId ?? 0) & 0xffff, 2);
        write(WORKSPACE + WS_ACTIVE_POS, (s.activePos ?? 0) >>> 0, 4);
        for (const p of s.participants ?? []) {
            const pos = p.pos ?? 0;
            write(WORKSPACE + WS_FLAG_BASE + pos * 4, p.participated ? 1 : 0, 1);
            for (let v = 0; v < 3; v++) {
                write(WORKSPACE + WS_FORM_BASE + pos * 4 + v, p.formFlags?.[v] ? 1 : 0, 1);
            }
        }
    }

    /** ctx+0x7C+id through the shared store's read, unmasked. */
    function readHostHeld(itemId) {
        return readHeldByte({ read8: (address) => r._host?.read(address, 1) ?? 0 }, itemId, SAVE);
    }

    function boot() {
        const host = openNativeScreen(MODULE_ID, {
            rootCtor: ROOT_CTOR,
            playPackedSound: (id) => { sfx?.playPacked(id); },
            seed,
        });
        if (!host) return false;
        r._host = host;
        r._seedBits = Math.max(0, Math.min(BIT_CAP, host.read(MONEY, 4) >>> 0));
        const seedItemId = r._seed?.dropItemId ?? 0;
        r._seedHeld = seedItemId > 0 ? readHostHeld(seedItemId) : 0;
        return true;
    }

    /** The screen's payout -> walker state. */
    function commit() {
        const host = r._host;
        const state = r._state;
        if (!host || !state) return;
        const bits = host.read(MONEY, 4) >>> 0;
        state.bits = Math.max(0, Math.min(BIT_CAP, bits));
        // The one count the screen can change (the item it drops) goes through the
        // shared store: the difference from what we carry is added or taken, so the
        // 99 cap and the 0 floor are the store's (F0x800161D8).
        const itemId = r._seed?.dropItemId ?? 0;
        if (itemId > 0) {
            setHeldCount(state, itemId, readHostHeld(itemId), heldCount(state, itemId));
        }
        if (typeof localStorage !== "undefined") {
            localStorage.setItem("bits", String(state.bits));
            localStorage.setItem("inventory", JSON.stringify(state.inventory));
        }
    }

    /**
     * The same read-back as commit(), run on every frame instead of only on close.
     * The overlay credits the wallet (stfgtrep F0x80084EC4 case 0x14, file 0x2664-0x2798)
     * and the bag count (case 0x15, file 0x279C-0x28E8) in the block that draws the page
     * that shows them, so the walker takes its totals on the frame they change. Both
     * writes are absolute, never a delta, so this still pays exactly once.
     */
    function payout() {
        if (!r._open || !r._state || !r._host) return;
        const bits = Math.max(0, Math.min(BIT_CAP, r._host.read(MONEY, 4) >>> 0));
        const itemId = r._seed?.dropItemId ?? 0;
        const held = itemId > 0 ? readHostHeld(itemId) : 0;
        if (bits === r._seedBits && held === r._seedHeld) return;
        commit();
        r._seedBits = bits;
        r._seedHeld = held;
    }

    r.open = (opts = {}) => {
        r._open = true;
        r._onClose = opts.onClose ?? null;
        r._state = opts.gameState ?? null;
        r._seed = {
            battleId: opts.battleId ?? 0,
            dropItemId: opts.dropItemId ?? 0,
            activePos: opts.activePos ?? 0,
            partySlots: opts.partySlots ?? [],
            participants: opts.participants ?? [],
        };
        r._lastDiagnostic = null;
        r._seedBits = null;
        r._seedHeld = null;
        preloadNativeScreens().catch((e) => {
            r._lastDiagnostic = `native screen preload failed: ${e?.message ?? e}`;
        });
        if (!boot()) r._pending = true;
    };

    r.isOpen = () => r._open;

    // Input arrives as key events, but the native screen reads the pad service's
    // held word once per frame (state.keys carries every held button).
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
                r._lastDiagnostic = "native report boot failed (manifest/overlay missing)";
                return;
            }
            r._pending = false;
        }
        const keys = r._state?.keys;
        r._host.setPad(keys ? maskFromButtons(keys) : 0);
        if (r._host.tick(dt)) r._finish();
        else payout();
    };

    r.draw = (ctx) => {
        if (!r._open || !r._host) return;
        // Framebuffer takeover: fit the native 320x240 image to the whole
        // canvas (the shared rule), so a fullscreen battle canvas fills rather
        // than drawing small in the top-left corner.
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        fitNativeScreen(ctx);
        r._host.draw(ctx, 320, 240);
        ctx.restore();
    };

    r.close = () => {
        if (r._open) r._finish();
    };

    r._finish = () => {
        if (!r._open) return;
        r._open = false;
        r._pending = false;
        const host = r._host;
        if (host) {
            commit(); // reads through r._host, so it must run first
            host.teardown();
        }
        r._host = null;
        const cb = r._onClose;
        r._onClose = null;
        cb?.();
    };

    /** Diagnostics for the lab and focused browser checks. */
    r.diagnostics = () => ({
        open: r._open,
        pending: r._pending,
        host: r._host?.state() ?? null,
        lastDiagnostic: r._lastDiagnostic,
    });

    return r;
}
