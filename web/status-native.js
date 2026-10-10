// The pause/status screen as a production native screen (Phase 6.3 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// The player meets the shipped pro/ststatus overlay: the three party panels
// (sprite, level, HP, MP), the BIT box, and the pause list the console capture
// under the lab canvas shows. This module is only the state adapter between
// web/game.js and the screen's RAM contract; the screen itself runs through
// web/native-screen-host.js and engine/native.
//
// Contract (.dw3-research/status-route/grunt-contract.md):
//   * the manifest root F0x80099a80 is the pause HOST; it spawns the page the
//     player sees from the overlay's own 14-word factory table 0x8009A988,
//     indexed variant*7 + row: variant = *(0x8005CCF4), row = *(0x8005CCF0)
//     (roles as read in F0x800996ec; the walker used to have them swapped).
//     Row -> factory: 0 ITEMS 0x80091e4c, 1 SORT 0x8009824c, 2 MAP 0x80099324,
//     3 TECHNIQUES 0x80096548, 4 STATUS 0x8008e8f8, 5 CARD FOLDERS 0x80084c48
//     (variant 1 only), 6 Demo Setup 0x80086450 (variant 1). The resident pause
//     home F0x8001270c stores the row at 0x8005CCF0 (F0x8001270c.c:184/359) and
//     the variant (card-folder presence, D0x80048f42) at 0x8005CCF4
//     (:84/:87). See .dw3-research/status-route/factory-table.md. Booting a page
//     ctor directly as root draws nothing (it needs the host context), so the
//     root is never overridden.
//   * party panels: party map 0x80048DA4 = u32[3] roster slots, roster records
//     0x80049494 stride 0x3DC (web/native-screen.js seedNativeScreenParty).
//   * BIT: 0x80048D34 + 0x6C = 0x80048DA0.
//   * input is the identity pad word (web/native-screen.js setNativeScreenPad).
//   * commit: the pause pages write the same resident save block the memory-card
//     screen packs (0x80048D34..0x8004B3F7, stgmcard F0x80084dcc.c:446-459), so
//     closing reads the block back once and applies every field the walker
//     models: money, the bag counts, the party order (0x80048DA4 u32[3]) and the
//     roster stat fields (0x80049494 stride 0x3DC). Per-page writers
//     (.dw3-research/status-route/commit-contract.md): ITEMS uses/equips write
//     the bag counts and record +0x26/+0x28/+0x2A/+0x2E/+0x30..+0x48; SORT
//     reorders the party map only; TECHNIQUES is the field-heal page (record
//     +0x2C MP and +0x28 HP); STATUS is read-only; CARD FOLDERS only launches the
//     album and folder-editor overlays. The equipment slots (record
//     +0x3C8..+0x3D3, RECORD_EQUIP_OFFSETS) and the card hand/album arrays ARE
//     applied, through the one close commit both pause routes call
//     (engine/dw3/ui/pause-close-commit.ts `commitPauseClose`); this adapter only
//     reads them out of the host's memory and hands them over.
//   * closing: the page's own Cross handling backs out one level; at the page's
//     top level it folds the page away, the page object reaches lifecycle 3 and
//     the host NULLs its child slot (host+0x24 -> +0x4; F0x800996ec's "child
//     pointer reads 0" branch is what the original resident home watches). That
//     slot going from non-zero to zero is the close signal. The old heuristic
//     ("no live object beyond the root") never fired: the screens keep dozens of
//     text-widget objects alive, so cancel left the host running on top of the
//     walker's menu. The page's own cancel is word bit 0x4000, the same bit every
//     other screen in the game reads as back, and the walker now sends it as that
//     bit (the name "cross"), so no adapter rewrites the pad word any more.

import {
    commitPauseClose, maskFromButtons, rosterSlotOfCharId, ui,
    wornCount, WORN_MAX, wornItemIds,
} from "./vendor/engine.js";
import {
    openNativeScreen,
    preloadNativeScreens,
    nativeScreensReady,
} from "./native-screen-host.js";
import { RECORD_EQUIP_OFFSETS, seedNativeScreenParty } from "./native-screen.js";

const MODULE_ID = "pro/ststatus";

/** Resident save context (0x80048D34) and the fields the pause pages read. */
const SAVE_CONTEXT = 0x80048d34;
const MONEY = SAVE_CONTEXT + 0x6c;
const HELD_COUNTS = SAVE_CONTEXT + 0x7c;
/** The second count array: how many of each item are WORN (stitshop 0x80089ECC,
 *  ststatus 0x8008F16C — both `lb` `base + 0x20F + id` straight into the "Equip"
 *  number). Seeded from the shared store's stored worn byte. */
const WORN_COUNTS = SAVE_CONTEXT + 0x20f;
const BIT_CAP = 0x98967f; // 9,999,999 (extract_bounds, money cap)
const ITEM_MAX_ID = 402;
const HELD_MAX = 99;
/** Card collection: the per-card copy count (cap 9) at ctx+0x3A2 and the album's
 *  ever-obtained flag at ctx+0x4DF (commit-contract.md §4; the arrays the Card
 *  Album and the folder editor read). 316 catalog ids fit before the flag array. */
const CARD_COUNTS = SAVE_CONTEXT + 0x3a2;
const CARD_SEEN = SAVE_CONTEXT + 0x4df;
const CARD_MAX_ID = 316;
const CARD_COPIES_MAX = 9;
/** The resident screen launcher F0x80016B88's request cells: the pause pages use
 *  them once, when CARD FOLDERS hands off to the Card Album (0x1200) or the
 *  folder editor (0x400) (commit-contract.md §4). */
const TRANSITION = SAVE_CONTEXT + 0x26c8;

/** Pause-home row selection: the two cells the host reads before spawning its
 *  page (factory-table.md §2). Row names are the pause menu's own labels. */
const PARTY_MAP = SAVE_CONTEXT + 0x70;
const ROSTER = 0x80049494;
const ROSTER_STRIDE = 0x3dc;
const ROW_CELL = 0x8005ccf0;
const VARIANT_CELL = 0x8005ccf4;
const PAGES = {
    items: { row: 0, variant: 0 },
    sort: { row: 1, variant: 0 },
    map: { row: 2, variant: 0 },
    techniques: { row: 3, variant: 0 },
    status: { row: 4, variant: 0 },
    cardfolders: { row: 5, variant: 1 },
    demosetup: { row: 6, variant: 1 },
};

export function createStatusNative(sfx = null, opts = {}) {
    const st = {
        _open: false,
        _pending: false,
        _host: null,
        _state: null,
        _onClose: null,
        _lastDiagnostic: null,
        _packed: {},
        // Kept across a screen hand-off: the disc's launcher brings the STATUS
        // screen back when the Card Album or the folder editor closes, so the
        // page it re-opens still needs this route's close callback. Same
        // contract as web/status-translated.js reopenPage; see
        // web/pause-home.js returnToPauseCardFolders for the evidence.
        _returnClose: null,
    };
    const playPackedSound = (id) => {
        const key = id >>> 0;
        st._packed[key] = (st._packed[key] ?? 0) + 1;
        // One lookup for every screen: the packed word names the sample through
        // the extracted manifest (web/packed-sound.js).
        sfx?.playPacked(key);
    };

    function boot() {
        const state = st._state ?? {};
        const host = openNativeScreen(MODULE_ID, {
            playPackedSound,
            seed: ({ write, rt }) => {
                // The page the player picked, exactly as the resident pause home
                // hands it to the overlay (factory-table.md §2-3).
                const page = PAGES[st._entry] ?? PAGES.items;
                write(ROW_CELL, page.row, 4);
                write(VARIANT_CELL, page.variant, 4);
                write(MONEY, Math.max(0, Math.min(BIT_CAP, Number(state.bits) || 0)), 4);
                for (const slot of Array.isArray(state.inventory) ? state.inventory : []) {
                    const id = Number(slot?.id);
                    const qty = Number(slot?.qty) || 0;
                    if (Number.isInteger(id) && id > 0 && id <= ITEM_MAX_ID) {
                        write(HELD_COUNTS + id, Math.max(0, Math.min(HELD_MAX, qty)), 1);
                    }
                }
                for (const id of wornItemIds(state)) {
                    write(WORN_COUNTS + id, Math.max(0, Math.min(WORN_MAX, wornCount(state, id))), 1);
                }
                seedNativeScreenParty(partySeed(state, rt));
                seedCards(write);
            },
        });
        if (!host) return false;
        st._host = host;
        return true;
    }

    /** The party panels read the party map plus the roster records the field
     *  already keeps (`state.partyStats` mirrors the walker's roster). Only the
     *  slots the party map names are seeded, so an empty pedestal stays empty. */
    function partySeed(state, rt) {
        const roster = Array.isArray(state.partyStats) ? state.partyStats : [];
        // Names: the pages draw the roster record's own raw name string, and the
        // original shows the BASE Digimon's name (nickname when the player gave
        // one). The provider is web/party.js partyRosterView via web/game.js.
        const view = typeof opts.roster === "function" ? (opts.roster(state) ?? []) : [];
        const equipment = Array.isArray(state.equipment) ? state.equipment : [];
        const positions = [];
        const stats = [];
        (state.party ?? []).forEach((member, i) => {
            if (!member) { positions.push(0xffffffff); return; }
            const rec = roster[i];
            // The member's own roster slot: ctx+0x70 holds it and the picture row
            // resolves by it, never the pedestal index (same identity the translated
            // route seats). See web/status-translated.js partySeed.
            const slot = rosterSlotOfCharId(member) ?? i;
            positions.push(slot);
            stats.push({
                slot,
                starterSlot: slot,
                name: view[i]?.name ?? null,
                forms: {
                    digimonId: view[i]?.digimonId ?? rec?.digimonId,
                    formLedger: view[i]?.formLedger ?? rec?.formLedger,
                    equippedForms: view[i]?.equippedForms ?? rec?.equippedForms,
                },
                level: rec?.level, tp: rec?.tp,
                hp: rec?.hp, maxHp: rec?.maxHp, mp: rec?.mp, maxMp: rec?.maxMp,
                exp: rec?.xp,
                // The thirteen stat halfwords come from the roster view, which
                // resolves the species row and adds the trained points through
                // the one shared element helper (web/party.js partyRosterView);
                // a raw stat block carries neither.
                core: view[i]?.core ?? rec?.core, elements: view[i]?.elements ?? rec?.elements,
                // The worn slots: the STATUS sheet's equipment page and the See
                // Equipment window read the record's own halfwords, so the
                // player's gear has to be in RAM before the page opens.
                equipment: equipment[i] ?? null,
            });
        });
        return { positions, stats };
    }

    /** The card collection the album and folder editor browse: per-card copy
     *  counts at ctx+0x3A2 and the ever-obtained album flag at ctx+0x4DF. The
     *  live collection comes from web/cardstate.js through opts.cards, so a
     *  close-time read-back mutates the walker's own object. Folder records are
     *  not seeded yet: nothing in production writes them until the folder
     *  editor is hosted natively (Phase 6.3 group 2), and their Shift-JIS name
     *  field must round-trip through that screen's own encoding. */
    function seedCards(write) {
        const collection = typeof opts.cards === "function" ? opts.cards() : null;
        if (!collection) return;
        for (const [id, n] of collection.owned ?? []) {
            const cardId = Number(id);
            if (Number.isInteger(cardId) && cardId >= 1 && cardId <= CARD_MAX_ID) {
                write(CARD_COUNTS + cardId, Math.max(0, Math.min(CARD_COPIES_MAX, Number(n) || 0)), 1);
                st._cardsSeeded = true;
            }
        }
        for (const id of collection.seen ?? []) {
            const cardId = Number(id);
            if (Number.isInteger(cardId) && cardId >= 1 && cardId <= CARD_MAX_ID) {
                write(CARD_SEEN + cardId, 1, 1);
                st._cardsSeeded = true;
            }
        }
    }

    st.open = (state, entry = "items", onClose = null) => {
        st._open = true;
        st._entry = PAGES[entry] ? entry : "items";
        st._cardsSeeded = false;
        sawChild = false;
        st._onClose = onClose;
        st._state = state ?? st._state ?? null;
        st._lastDiagnostic = null;
        preloadNativeScreens().catch((e) => {
            st._lastDiagnostic = `native screen preload failed: ${e?.message ?? e}`;
        });
        if (!boot()) st._pending = true;
    };

    st.isOpen = () => st._open;

    /** Re-open one page in the same pause, the way the disc's screen manager
     *  brings the STATUS screen back: the host builds the page its remembered
     *  row names (F0x800996EC reads D0x8005CCF0), the page is fresh, and Back
     *  returns to the home list. `row` is that remembered row (5 = CARD
     *  FOLDERS); "home" is the list, not a page, so it is refused. */
    st.reopenPage = (page, row = 5) => {
        if (page === "home" || !PAGES[page]) return false;
        st.open(st._state, page, st._returnClose);
        return true;
    };

    st.handleKey = (_k, state) => {
        if (state && !st._state) st._state = state;
    };

    /** The page the host spawned, read out of the host's aux array slot
     *  (root+0x24 -> +0x4). F0x800996ec stores the factory's return there and the
     *  host NULLs it when the page folds away, so the slot is the close signal
     *  the original resident home reads. The slot is 0 until the host's first
     *  tick spawns the page, so a boot frame with no child is NOT a close. */
    let sawChild = false;
    function pageChild() {
        const rt = st._host?.rt;
        if (!rt) return 0;
        const root = rt.world.objects[0]?.addr ?? 0;
        if (!root) return 0;
        const aux = st._host.read(root + 0x24, 4) >>> 0;
        return aux ? (st._host.read(aux + 4, 4) >>> 0) : 0;
    }

    st.update = (dt) => {
        if (!st._open) return;
        if (st._pending) {
            if (!nativeScreensReady()) {
                preloadNativeScreens().catch(() => {});
                return;
            }
            if (!boot()) {
                st._lastDiagnostic = "native status boot failed (manifest/overlay missing)";
                return;
            }
            st._pending = false;
        }
        const keys = st._state?.keys;
        // The pad word goes over as it stands. Its back bit is 0x4000 and its
        // confirm bit 0x2000, which are the bits the page reads
        // (pause-status.ts `pressed(0xd)` / `pressed(0xe)`), because the page's
        // own code is the original's. The page's cancel backs out one level and,
        // at its top level, folds the page away (which NULLs the child slot and
        // ends the pause), so it is the page that closes, not this adapter.
        st._host.setPad(keys ? maskFromButtons(keys) : 0);
        const finished = st._host.tick(dt);
        // A page can ask the resident launcher (F0x80016B88) for another screen:
        // CARD FOLDERS does it for the Card Album (0x1200) and the folder editor
        // (0x400) and then waits for the launched screen to return. This host
        // loads one overlay, so the request is surfaced to the caller (web/game.js
        // opens the walker's screen for it) and the page closes instead of
        // wedging on a transition that will never complete.
        const transition = st._host.read(TRANSITION, 4) >>> 0;
        if (transition) {
            const arg = st._host.read(TRANSITION + 8, 4) >>> 0;
            // A page that launched another screen keeps its close callback for
            // the return: that screen's end brings the STATUS screen back, and
            // reopenPage re-opens the page with it (see reopenPage above).
            st._returnClose = st._onClose;
            st._finish();
            opts.onTransition?.(transition, arg);
            return;
        }
        const child = pageChild();
        if (child) sawChild = true;
        if (finished || (sawChild && !child)) st._finish();
    };

    st.draw = (ctx, viewW, viewH) => {
        if (!st._open || !st._host) return;
        st._host.draw(ctx, viewW, viewH);
    };

    st.close = () => {
        if (!st._open) return;
        st._finish();
    };

    st._finish = () => {
        if (!st._open) return;
        st._open = false;
        st._pending = false;
        const host = st._host;
        st._host = null;
        if (host) {
            readBack(host);
            host.teardown();
        }
        const cb = st._onClose;
        st._onClose = null;
        cb?.();
    };

    /** Apply the resident save block the pause pages wrote, once, on close.
     *  The commit itself is the one shared routine both pause routes call
     *  (engine/dw3/ui/pause-close-commit.ts); this reads the numbers out of the
     *  host's memory and hands them over. The card arrays are read here because
     *  only this route seeds them, and the count clamps belong with the reads. */
    function readBack(host) {
        const state = st._state;
        if (!state) return;
        const inventory = [];
        for (let id = 1; id <= ITEM_MAX_ID; id++) {
            const qty = Number(host.read(HELD_COUNTS + id, 1)) & 0xff;
            if (qty > 0) inventory.push({ id, qty });
        }
        const money = Number(host.read(MONEY, 4)) >>> 0;
        const partyMap = [0, 1, 2].map((i) => (host.read(PARTY_MAP + i * 4, 4) >>> 0));
        // The card arrays the album and folder editor write (commit-contract.md
        // §4). They round-trip exactly because seedCards put the walker's own
        // collection into RAM before the page opened; nothing in production writes
        // them yet, so this is the pair that keeps the two models identical. Only
        // applied when the seed actually put cards in RAM: a collection that appeared
        // after the page opened (the boot starter-deck fetch) must not be wiped by an
        // empty read-back.
        const collection = typeof opts.cards === "function" ? opts.cards() : null;
        let cards = null;
        if (st._cardsSeeded && collection?.owned instanceof Map && collection?.seen instanceof Set) {
            const owned = new Map();
            const seen = new Set();
            for (let id = 1; id <= CARD_MAX_ID; id++) {
                const copies = Number(host.read(CARD_COUNTS + id, 1)) & 0xff;
                if (copies > 0) owned.set(id, Math.min(CARD_COPIES_MAX, copies));
                if (Number(host.read(CARD_SEEN + id, 1)) & 0xff) seen.add(id);
            }
            cards = { owned, seen, live: collection };
        }
        // The element values the page opened with (species base + elemBonuses), keyed
        // by ROSTER SLOT: the commit folds each record against the slot that record
        // names, so a position-keyed list would measure the wrong member after a SORT.
        const openView = typeof opts.roster === "function" ? (opts.roster(state) ?? []) : [];
        const openedElements = [];
        for (let i = 0; i < 3; i++) {
            const member = (state.party ?? [])[i];
            if (!member) continue;
            const slot = rosterSlotOfCharId(member);
            if (slot === null || slot === undefined) continue;
            openedElements[slot] = openView[i]?.elements ?? null;
        }
        commitPauseClose({
            state,
            money,
            inventory,
            partyMap,
            cards,
            formId: (value) => ui.nativeFormIds({ read16: (a) => host.read(a, 2) }).idByValue.get(value),
            openedElements,
            storage: typeof localStorage !== "undefined" ? localStorage : null,
            recordAt: (rosterSlot) => {
                const base = ROSTER + rosterSlot * ROSTER_STRIDE;
                const equipment = {};
                for (const [name, off] of RECORD_EQUIP_OFFSETS) {
                    equipment[name] = host.read(base + off, 2) & 0xffff;
                }
                return {
                    formValue: host.read(base + 4, 4) >>> 0,
                    level: host.read(base + 0x24, 2) & 0xffff,
                    tp: host.read(base + 0x26, 2) & 0xffff,
                    hp: host.read(base + 0x28, 2) & 0xffff,
                    maxHp: host.read(base + 0x2a, 2) & 0xffff,
                    mp: host.read(base + 0x2c, 2) & 0xffff,
                    maxMp: host.read(base + 0x2e, 2) & 0xffff,
                    exp: host.read(base + 0x20, 4) >>> 0,
                    core: Array.from({ length: 6 }, (_, i) => host.read(base + 0x30 + i * 2, 2) & 0xffff),
                    elements: Array.from({ length: 7 }, (_, i) => host.read(base + 0x3c + i * 2, 2) & 0xffff),
                    equipment,
                };
            },
        });
    }

    /** Focused-verification hook: write into the running screen's RAM through
     *  the host (the lab's nativeScreenWrite is not reachable from the game
     *  page). Used by tools/verify_native_status.mjs to prove the close-time
     *  read-back; not part of the player path. */
    st.writeMemory = (addr, value, size = 4) => st._host?.write?.(addr, value, size) ?? null;

    /** Diagnostics for the lab and focused browser checks. */
    st.diagnostics = () => ({
        open: st._open,
        pending: st._pending,
        entry: st._entry ?? null,
        packed: { ...st._packed },
        host: st._host?.state() ?? null,
        // Live objects and the host's page-child slot. The host stores the page
        // it spawned in its aux array (host+0x24 -> +0x4) and NULLs the slot when
        // the page folds away (F0x800996ec), so that slot is the close signal.
        screen: (() => {
            const rt = st._host?.rt;
            if (!rt) return null;
            const read = (a) => st._host.read(a, 4) >>> 0;
            const root = rt.world.objects[0]?.addr ?? 0;
            const aux = root ? read(root + 0x24) : 0;
            const child = aux ? read(aux + 4) : 0;
            return {
                root, aux, child,
                objects: rt.world.objects.map((o) => ({
                    addr: o.addr >>> 0, cb: o.cb >>> 0, alive: o.alive,
                })),
                rootState: root ? read(root + 0xc) : null,
                rootUnk10: root ? read(root + 0x10) : null,
                childState: child ? read(child + 0xc) : null,
                childUnk10: child ? read(child + 0x10) : null,
                childUnk14: child ? read(child + 0x14) : null,
                childUnk18: child ? read(child + 0x18) : null,
                childUnk5C: child ? read(child + 0x5c) : null,
                childUnk7C: child ? read(child + 0x7c) : null,
            };
        })(),
        renderer: st._host?.renderer
            ? (() => {
                const r = st._host.renderer.stats;
                return {
                    frames: r.frames, clips: r.clips, skipped: r.skipped,
                    byPack: { ...r.byPack }, seen: [...r.seen], last: r.last,
                };
            })()
            : null,
        lastDiagnostic: st._lastDiagnostic,
    });

    return st;
}
