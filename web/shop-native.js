// The item shop as a production native screen (Phase 6.1 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// The player meets the shipped pro/stitshop overlay: greeting fade, the
// shop-name/BIT header, the BUY/SELL menu, the buy list, the quantity spinner,
// the Buy/No plate and the sell flow. This module is only the state adapter
// between web/game.js and the screen's RAM contract; the screen itself runs
// through web/native-screen-host.js and engine/native.
//
// Contract (docs/research/ui/shop-system-decompiled.md and the root routines
// F0x8008c118/F0x8008bfb0/F0x8008b908):
//   * 0x8004b404 = the shop id the root reads (getCurrentShopId, F0x80016b78)
//     before it builds the header and spawns the BUY/SELL sub-objects;
//   * 0x80048d34 + 0x6C       = BIT (money), clamped to 9,999,999;
//   * 0x80048d34 + 0x7C + id  = the per-item held-count byte (cap 99);
//   * the root object's lifecycle (+0xC) reaching 3 is the player leaving; the
//     original manager destroys it and the host reads the state back once.
//
// Ordinary merchants use this screen. ?legacyShop=1 selects the authored
// comparison screen.

import {
    elementValue, maskFromButtons, reconcileHeldCounts, rosterSlotOfCharId, setEquippedItem,
    wornCount, wornItemIds, WORN_MAX,
} from "./vendor/engine.js";
import {
    openNativeScreen,
    preloadNativeScreens,
    nativeScreensReady,
} from "./native-screen-host.js";
import { nativeRootCtorFor } from "./native-screen-roots.js";

import { RECORD_EQUIP_OFFSETS, seedNativeScreenParty } from "./native-screen.js";
import { partyRosterView, syncLeadEquipBonuses } from "./party.js";
import { ensureStoredStats } from "./battle.js";

const CORE = ["str", "def", "spt", "wis", "spd", "chr"];
const ELEMENTS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"];
const ROSTER = 0x80049494;
const STRIDE = 0x3dc;

const MODULE_ID = "pro/stitshop";
/** The scene that owns the BUY/SELL menu; the manifest records only the BUY
 *  tab. See web/native-screen-roots.js. */
const SHOP_ROOT_CTOR = nativeRootCtorFor(MODULE_ID);

/** Resident save/party context the shop reads and writes. */
const SAVE_CONTEXT = 0x80048d34;
const SHOP_ID_CELL = 0x8004b404;
const MONEY = SAVE_CONTEXT + 0x6c;
const HELD_COUNTS = SAVE_CONTEXT + 0x7c;
/** The second count array: how many of each item are WORN. The shop's info band
 *  reads it with `lb base + 0x20F + id` (stitshop 0x80089ECC, file 0x721C) for
 *  its "Equip" number, and the equip-apply writes it (0x8008C880 / 0x8008CA30). */
const WORN_COUNTS = SAVE_CONTEXT + 0x20f;
const ITEM_MAX_ID = 402; // the shipped item catalogue ends at 402
const HELD_MAX = 99;
const BIT_CAP = 0x98967f; // 9,999,999 (shop-system-decompiled §2026-08-04)

/** The seven packed sound ids the shop state machines play, as their browser
 *  names (claim shop-sfx-seven-2026-09-09, proved live 2026-09-10). They all
 *  resolve through the one lookup now (web/packed-sound.js). */

export function createShopNative(sfx = null, opts = {}) {
    const sh = {
        _open: false,
        _pending: false,
        _host: null,
        _state: null,
        _onClose: null,
        _shopId: 0,
        _bootFrames: 0,
        _lastDiagnostic: null,
    };

    const playPackedSound = (id) => { sfx?.playPacked(id); };

    function boot() {
        const state = sh._state ?? {};
        const inventory = Array.isArray(state.inventory) ? state.inventory : [];
        const host = openNativeScreen(MODULE_ID, {
            rootCtor: SHOP_ROOT_CTOR,
            playPackedSound,
            preBoot: ({ write }) => write(SHOP_ID_CELL, sh._shopId | 0, 4),
            seed: ({ write }) => {
                // The original launcher hands the shop id through the resident
                // cell the root ctor reads; the wallet and the bag are the same
                // resident state the field writes.
                const db = opts.digimonDB?.() ?? {};
                const view = partyRosterView(state.party, state.partnerStats, state.partyStats, db, state.digimonNames);
                seedNativeScreenParty({
                    positions: view.map(v => rosterSlotOfCharId(v.charId) ?? 0xffffffff),
                    stats: view.map((v, i) => {
                        const rec = (i === 0 ? state.partnerStats : state.partyStats?.[i]) ?? {};
                        const core = v.profile ? ensureStoredStats(rec, v.profile) : rec.stats ?? {};
                        const slot = rosterSlotOfCharId(v.charId);
                        return { ...v, slot, starterSlot: slot, exp: v.xp,
                            forms: rec,
                            core: CORE.map(k => (Number(core[k]) || 0) + (Number(rec.bonuses?.[k]) || 0)),
                            // The roster record's STORED element halfwords (species base + every
                            // trained point); the shop screen's own original-code
                            // fill adds the worn gear's resist on top through
                            // F0x80017174. One shared helper for the stored half.
                            elements: ELEMENTS.map(k => elementValue(v.profile, rec.elemBonuses, k)),
                            equipment: state.equipment?.[i],
                        };
                    }),
                });
                write(MONEY, Number(state.bits) || 0, 4);
                for (const slot of inventory) {
                    const id = Number(slot?.id);
                    const qty = Number(slot?.qty) || 0;
                    if (Number.isInteger(id) && id > 0 && id <= ITEM_MAX_ID) {
                        write(HELD_COUNTS + id, Math.max(0, Math.min(HELD_MAX, qty)), 1);
                    }
                }
                for (const id of wornItemIds(state)) {
                    write(WORN_COUNTS + id, Math.max(0, Math.min(WORN_MAX, wornCount(state, id))), 1);
                }
            },
        });
        if (!host) return false;
        sh._host = host;
        return true;
    }

    sh.open = (stock, onClose = null, opts = {}) => {
        sh._open = true;
        sh._onClose = onClose;
        sh._state = opts.state ?? sh._state ?? null;
        // shopId is the native stock selector (STITSHOP_SHOPS[shop_id]). The
        // stock array is the same extracted table the native screen reads, so
        // an absent id is a wiring bug, not a cue to invent one.
        const id = Number(opts.shopId);
        sh._shopId = Number.isInteger(id) && id >= 0 ? id : 0;
        sh._lastDiagnostic = Number.isInteger(id) ? null : "shop.open without shopId";
        sh._bootFrames = 0;
        preloadNativeScreens().catch((e) => {
            sh._lastDiagnostic = `native screen preload failed: ${e?.message ?? e}`;
        });
        if (!boot()) sh._pending = true;
    };

    sh.isOpen = () => sh._open;

    // Input arrives as key events, but the native screen reads the pad service's
    // held word once per frame (state.keys already carries every held button),
    // so handleKey only keeps the adapter's state reference current.
    sh.handleKey = (_k, state) => {
        if (state && !sh._state) sh._state = state;
    };

    sh.update = (dt) => {
        if (!sh._open) return;
        if (sh._pending) {
            sh._bootFrames += 1;
            if (!nativeScreensReady()) {
                preloadNativeScreens().catch(() => {});
                return;
            }
            if (!boot()) {
                sh._lastDiagnostic = "native shop boot failed (manifest/overlay missing)";
                return;
            }
            sh._pending = false;
        }
        const keys = sh._state?.keys;
        // The pad word goes over as it stands. The shop's own machines ask for
        // logical 0x0D to confirm and 0x0E to cancel (shop-root-machine.ts:90/94),
        // which are word bits 0x2000 and 0x4000 - the bits the walker now sends.
        sh._host.setPad(keys ? maskFromButtons(keys) : 0);
        if (sh._host.tick(dt)) sh._finish();
    };

    sh.draw = (ctx, viewW, viewH) => {
        if (!sh._open || !sh._host) return;
        sh._host.draw(ctx, viewW, viewH);
    };

    sh.close = () => {
        if (!sh._open) return;
        sh._finish();
    };

    sh._finish = () => {
        if (!sh._open) return;
        sh._open = false;
        sh._pending = false;
        const host = sh._host;
        sh._host = null;
        if (host) {
            const bits = Number(host.read(MONEY, 4)) >>> 0;
            const state = sh._state;
            if (state) {
                state.bits = Math.max(0, Math.min(BIT_CAP, bits));
                // The screen wrote the save block's held-count array; hand every
                // count to the shared store instead of replacing the bag.
                const inventory = [];
                for (let id = 1; id <= ITEM_MAX_ID; id++) {
                    const qty = Number(host.read(HELD_COUNTS + id, 1)) & 0xff;
                    if (qty > 0) inventory.push({ id, qty });
                }
                reconcileHeldCounts(state, inventory);
                // The screen wrote the roster's six equip halfwords; diff them per
                // member so the stored worn byte moves with the record
                // (ststatus 0x8009A4AC / 0x8009A5E4).
                state.equipment ??= [];
                (state.party ?? []).forEach((member, i) => {
                    const slot = rosterSlotOfCharId(member);
                    if (slot == null) return;
                    for (const [name, off] of RECORD_EQUIP_OFFSETS) {
                        setEquippedItem(state, i, name, Number(host.read(ROSTER + slot * STRIDE + off, 2)) & 0xffff);
                    }
                });
                syncLeadEquipBonuses(state);
                if (typeof localStorage !== "undefined") {
                    localStorage.setItem("equipment", JSON.stringify(state.equipment));
                    localStorage.setItem("worn", JSON.stringify(state.worn ?? {}));
                    localStorage.setItem("inventory", JSON.stringify(inventory));
                }
            }
            host.teardown();
        }
        const cb = sh._onClose;
        sh._onClose = null;
        cb?.();
    };

    /** Diagnostics for the lab and focused browser checks. */
    sh.nativeState = () => sh._host?.state() ?? null;
    sh.diagnostics = () => ({
        open: sh._open,
        pending: sh._pending,
        shopId: sh._shopId,
        host: sh._host ? {
            ...(sh._host.state() ?? {}),
            // The sheets the screen draws from, and whether the host ever had to
            // hold a frame back for one. A packWait above zero means the
            // greeting fade lost frames (web/native-screen-host.js).
            packsReady: sh._host.ready(),
            packWaitFrames: sh._host.packWait(),
        } : null,
        renderer: sh._host?.renderer
            ? (() => {
                const r = sh._host.renderer.stats;
                return {
                    frames: r.frames, paintedFrames: r.paintedFrames, clips: r.clips,
                    skipped: r.skipped, awaiting: r.awaiting, cards: r.cards,
                    byPack: { ...r.byPack }, seen: [...r.seen], last: r.last,
                    skippedList: r.skippedList.map((e) => ({ ...e })),
                    paintOrder: r.paintOrder.map((p) => ({ id: p.id, bucket: p.bucket })),
                };
            })()
            : null,
        lastDiagnostic: sh._lastDiagnostic,
    });

    return sh;
}
