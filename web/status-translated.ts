// Browser state and painting adapter for the translated pause screens (pro/ststatus).
// The screens' logic runs in engine/dw3/ui (PauseRootSession); this file loads its
// data, seeds the walker's party, bag and money into the session, forwards the held
// buttons, paints the picture calls, text and the two flat quads, and reads the changes
// back once on close. It never executes original instructions.
//
// The adapter answers the same calls as the reference route: open(state, entry, onClose),
// isOpen(), handleKey(key, state), update(dt), draw(ctx, w, h), close() and diagnostics().
import {
    commitPauseClose, maskFromButtons, rosterSlotOfCharId, wornCount, wornItemIds, ui, ITEM_ID_MAX,
} from "./vendor/engine.js";
import type { PauseEntry, PauseRootSession } from "../engine/dw3/ui/pause-root-session.js";
import type { PackedSfx, ResidentGlyphs, WalkerState } from "./types/translated-screens.js";
import type { EngineUi } from "./types/battle.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { paintNativeSession } from "./native-session.js";
import * as uiC from "./ui-c/index.js";
import { pickPauseScreen } from "./ui-c/screens.js";
import { dimOf } from "./ui-c/geometry.js";
import { fetchBytes, fetchJson, loadProfileRecords, loadResidentResources } from "./resident-data.js";
import type { StatusScreen, StatusTranslatedOpts } from "./types/status-translated.js";
type PauseResidentResources = Awaited<ReturnType<typeof loadResidentResources>>;

type PauseManifestData = Awaited<ReturnType<typeof fetchJson>>;

type PauseCatalogData = Awaited<ReturnType<typeof fetchJson>>;

type PauseProfileRecords = Awaited<ReturnType<typeof loadProfileRecords>>;


interface PauseSharedData {
  manifest: PauseManifestData;
  tables: Uint8Array;
  resident: Uint8Array;
  homeData: Uint8Array;
  profiles: PauseProfileRecords;
  font: PauseResidentResources["font"];
  cursorGlyphs: PauseResidentResources["cursorGlyphs"];
  catalog: PauseCatalogData;
  itemRecords: Uint8Array;
  descriptors: [Uint8Array, Uint8Array];
}


// The picture handles the pages ask for: the pause chrome, the shared item/icon
// sheet, and the MAP page's own three sheets per server. A handle is
// (pack << 16) | subPack (F0x80099324: `pack << 16`, `| 1` for the area list, `| 2`
// for the markers), so the map's three SHEETS need the whole handle and the two
// whole-archive packs only need the directory.
const PACKS: Record<string, string> = {
    0x0404: "ststat", 0x0286: "cmfont",
    0x07990000: "stwmp0map", 0x07990001: "stwmp0area", 0x07990002: "stwmp0icon",
    0x079b0000: "stwmp1map", 0x079b0001: "stwmp1area", 0x079b0002: "stwmp1icon",
};
const packNameFor = (handle: number) => PACKS[handle] ?? PACKS[(handle >>> 16) & 0xffff] ?? null;
const PAGES = new Set<string>(["home", "items", "sort", "map", "techniques", "status", "cardfolders", "quests"]);

const DATA_LABEL = "Pause data";
let pauseCount = 0;

let sharedPromise = null;
const loadShared = (): Promise<PauseSharedData> => {
    sharedPromise ??= (async () => {
        const [manifest, tables, resident, homeData, profiles, { font, cursorGlyphs }, catalog, itemRecords, main, extra] = await Promise.all([
            fetchJson("pause/manifest.json", DATA_LABEL), fetchBytes("pause/tables.bin", DATA_LABEL),
            fetchBytes("pause/resident.bin", DATA_LABEL), fetchBytes("pause/home-data.bin", DATA_LABEL),
            loadProfileRecords(DATA_LABEL),
            loadResidentResources(), fetchJson("shop_catalog.json", DATA_LABEL), fetchBytes("shop_item_records.bin", DATA_LABEL),
            fetchBytes("shop_descriptors_main.bin", DATA_LABEL), fetchBytes("shop_descriptors_extra.bin", DATA_LABEL),
        ]);
        return { manifest, tables, resident, homeData, profiles, font, cursorGlyphs, catalog, itemRecords, descriptors: [main, extra] };
    })().catch((error) => { sharedPromise = null; throw error; });
    return sharedPromise;
};

/** The game's own text codec for the roster record's name (web/native-screen.js): a single
 *  byte 0x04+d is a digit, 0x0E+n a capital, 0x28+n a lower-case letter; anything else is
 *  the two-byte space 0x01,0x01. */
export function encodePauseName(text: unknown, maxBytes = 23) {
    const out: number[] = [];
    for (const ch of String(text ?? "")) {
        const code = ch.charCodeAt(0);
        if (ch >= "0" && ch <= "9") out.push(0x04 + code - 0x30);
        else if (ch >= "A" && ch <= "Z") out.push(0x0e + code - 0x41);
        else if (ch >= "a" && ch <= "z") out.push(0x28 + code - 0x61);
        else out.push(0x01, 0x01);
        if (out.length >= maxBytes) break;
    }
    return new Uint8Array(out.slice(0, maxBytes));
}

/** The MAP page's "have I walked into this place" reader: the exact flag id the page's
 *  own scan asks about (F0x8009A6B8, get_flag((stage & 0xff) | 0x2000, 1)) over the PS1
 *  stage ids the walker resolved through the engine's banked store. */
export function mapSeenReader(context: { seen?: number[] } | null | undefined) {
    const flags = new Set((context?.seen ?? []).map((ps1: number) => 0x2000 | (ps1 & 0xff)));
    return (flagId: number) => flags.has(flagId);
}

export function createStatusTranslated(sfx: PackedSfx | null = null, opts: StatusTranslatedOpts = {}) {
    const st: StatusScreen = {
        _open: false, _session: null, _state: null, _onClose: null, _clock: null, _error: null,
        _request: 0, _entry: null, _lastDiagnostic: null, _packed: {},
        _homeFlow: false, _homeOverlay: false, _homeRow: 0,
        // The close callback the session was opened with, kept across a screen
        // hand-off: the disc's launcher brings the STATUS screen back when the
        // Card Album or the folder editor closes, so the page it re-opens must
        // still know how to close the pause. See returnToPauseCardFolders in
        // web/pause-home.js for the evidence.
        _returnClose: null,
        _uiKey: `pause${++pauseCount}`,
    };
    const renderer = createNativeScreenRenderer({ pack: "ststat", packs: PACKS }, packNameFor);
    const playPackedSound = (id: number) => {
        const key = id >>> 0;
        st._packed[key] = (st._packed[key] ?? 0) + 1;
        sfx?.playPacked(key);
    };

    /** The three party panels: one entry per pedestal, null for an empty one. */
    function partySeed(state: WalkerState) {
        const roster = Array.isArray(state.partyStats) ? state.partyStats : [];
        const view = typeof opts.roster === "function" ? (opts.roster(state) ?? []) : [];
        const equipment = Array.isArray(state.equipment) ? state.equipment : [];
        const party = [];
        for (let i = 0; i < 3; i++) {
            const member = (state.party ?? [])[i];
            if (!member) { party.push(null); continue; }
            const rec = roster[i];
            // The member's own roster slot — the identity ctx+0x70 holds and the
            // picture row resolves by. NOT the pedestal index: seating that here made
            // each card draw whichever starter owned the pedestal's row, and a reorder
            // permuted those wrong sprites (Patamon showing Kotemon's). Same field the
            // sibling sessions seat: web/gym-translated.js `rosterSlotFor(party[i])`,
            // web/save-translated.js `partySlots[i]`.
            const slot = rosterSlotOfCharId(member) ?? i;
            party.push({
                rosterSlot: slot,
                starterSlot: slot,
                nameBytes: view[i]?.name ? encodePauseName(view[i].name) : undefined,
                forms: {
                    digimonId: view[i]?.digimonId ?? rec?.digimonId,
                    formLedger: view[i]?.formLedger ?? rec?.formLedger,
                    equippedForms: view[i]?.equippedForms ?? rec?.equippedForms,
                },
                level: rec?.level, tp: rec?.tp, hp: rec?.hp, maxHp: rec?.maxHp, mp: rec?.mp, maxMp: rec?.maxMp,
                exp: rec?.xp,
                // The thirteen stat halfwords come from the roster view, which
                // resolves the species row and adds the trained points through
                // the one shared element helper (web/party.js partyRosterView);
                // a raw stat block carries neither.
                core: view[i]?.core ?? rec?.core, elements: view[i]?.elements ?? rec?.elements,
                equipment: equipment[i] ?? undefined,
            });
        }
        return party;
    }

    function seed(state: WalkerState, entry: PauseEntry) {
        const inventory = [];
        for (const slot of Array.isArray(state.inventory) ? state.inventory : []) {
            const id = Number(slot?.id);
            if (Number.isInteger(id) && id > 0 && id <= ITEM_ID_MAX) inventory.push({ id, qty: Number(slot?.qty) || 0 });
        }
        // The second count array: the ITEMS page's detail band reads its "Equip"
        // number from `base + 0x20F + id` (ststatus 0x8008F16C), so the stored worn
        // byte is seeded here and that figure is that byte.
        const worn = wornItemIds(state).map((id) => ({ id, qty: wornCount(state, id) }));
        const context = typeof opts.map === "function" ? (opts.map(state) ?? null) : null;
        const extraRows = entry === "home" ? (opts.extraRows?.(state) ?? []) : [];
        return {
            page: entry, money: Number(state.bits) || 0, inventory, worn, party: partySeed(state),
            stage: context?.stage ?? 0, mapSeen: mapSeenReader(context),
            homeOverlay: st._homeOverlay, homeRow: st._homeRow,
            cardFoldersUnlocked: !!opts.cardFoldersUnlocked?.(),
            // EXTRA (not on the disc): more rows on the pause home list (the extra quests, the GLOSSARY and OPTIONS books)
            ...(extraRows.length ? { extraRows } : {}),
            ...(entry === "quests" && opts.questsPage?.(state) ? { quests: opts.questsPage(state) } : {}),
        };
    }

    st.open = (state, entry = "items", onClose = null, homeFlow = false) => {
        const page = PAGES.has(entry) ? entry : "items";
        st._homeFlow = homeFlow;
        st._open = true;
        st._entry = page;
        st._state = state ?? st._state ?? null;
        st._onClose = onClose;
        st._error = null;
        st._session = null;
        st._lastDiagnostic = null;
        st._clock = new (ui as EngineUi).MenuDisplayClock();
        st._padLag = [];
        const request = ++st._request;
        loadShared().then(async (shared) => {
            const selected = st._state?.languageByte;
            const language = Number.isInteger(selected) ? selected : 2;
            if (language! < 0 || language! > 6) throw new Error("Pause language index is invalid");
            const own = new Set(shared.manifest.banks.map((bank: { id: number }) => bank.id));
            const dirs = new Map(shared.manifest.sharedBanks.map((entryRow: { offset: number; dir: string }): [number, string] => [entryRow.offset, entryRow.dir]));
            const banks = new Map(await Promise.all((ui as EngineUi).PAUSE_TEXT_BANK_OFFSETS.map(async (offset): Promise<[number, Uint8Array]> => {
                const id = offset + language;
                return [id, await fetchBytes(own.has(id) ? `pause/${id}.bin` : `${dirs.get(offset)}/${id}.bin`, DATA_LABEL)];
            })));
            if (!st._open || request !== st._request) return;
            // ETS item 9: `page` is one of the PAGES the line above just checked, and PAGES holds exactly the engine's PauseEntry ids
            st._session = new (ui as EngineUi).PauseRootSession(language, seed(st._state ?? {}, page as PauseEntry), {
                tables: shared.tables, resident: shared.resident, residentRanges: shared.manifest.resident.ranges,
                homeData: shared.homeData, profiles: shared.profiles,
                // ETS item 9: web/resident-data.ts types the glyph table as {}; it is the engine's CursorGlyphTable
                font: shared.font, cursorGlyphs: shared.cursorGlyphs as ResidentGlyphs, catalog: shared.catalog, itemRecords: shared.itemRecords,
                descriptors: shared.descriptors, banks,
            }, { playSound: playPackedSound });
        }).catch((error) => {
            if (request !== st._request) return;
            st._error = error;
            st._lastDiagnostic = `translated pause failed: ${error?.message ?? error}`;
            console.error("Translated pause screen failed to open", error);
        });
    };

    st.isOpen = () => st._open;
    /** "home" while the pause list itself is up, otherwise the page that is open (items, map, status, ...). */
    st.entry = () => (st._open ? st._entry : null);
    st.openHome = (state, onClose = null, row = 0) => {
        st._homeOverlay = false;
        st._homeRow = row;
        st.open!(state, "home", onClose, true);
    };
    /** Re-open one translated page in the same pause, as the disc's screen
     *  manager does when the screen it handed over to comes back: the host
     *  builds the page its remembered row names (F0x800996EC reads
     *  D0x8005CCF0), the page is fresh, so its own cursor starts at row 0 and
     *  Back returns to the home list on the row the player left from. `row` is
     *  that remembered row (5 = CARD FOLDERS). Only a real page is accepted —
     *  "home" is the list the host builds when a page closes, not a page. */
    st.reopenPage = (page, row = 5) => {
        if (page === "home" || !PAGES.has(page)) return false;
        st._homeOverlay = true;
        st._homeRow = Number.isInteger(row) ? row : 5;
        st.open!(st._state, page, st._returnClose!, true);
        return true;
    };
    /** Buttons (words) that were down when this pause came back from a book: the list ignores each until it is let go. */
    st.blockUntilReleased = (words = []) => { st._blocked = new Set(words); };
    st.handleKey = (_k, state) => { if (state && !st._state) st._state = state; };

    st.update = (dt) => {
        if (!st._open) return;
        if (st._error) { st._finish!(false); return; }
        const session = st._session;
        if (!session) return;
        // The held word is already the word the pages read: web/input.js hands every
        // screen the bit a physical button reaches, and the disc's rotation happens
        // there and only there (engine/systems/input-map.ts `padWordButton`).
        let keys = st._state?.keys ? [...st._state.keys] : [];
        if (st._blocked?.size) {
            for (const w of [...st._blocked]) if (!keys.includes(w)) st._blocked.delete(w);
            keys = keys.filter((w) => !st._blocked!.has(w));
        }
        // The console's pages see a press one frame after it happens: on the disc every
        // pause page reacted exactly one frame later than these pages fed at once (182 of 182
        // timed presses, docs/research/ui/captures/pause-menu-robot-map-2026-09-29.md).
        for (const frame of st._clock.advance(dt)) {
            session.tick(st._padLag, frame.tick);
            st._padLag = keys;
            if (session.finished()) {
                if (st._homeFlow && st._entry === "home") {
                    const result = session.homeResult();
                    if (result?.kind === "page" && result.page === "map" && opts.newMapScreen?.()) {
                        // OPTIONS > Map screen: New. The MAP row opens the new map book instead of the disc's page (same way out and back as a book).
                        st._finish!(false);
                        opts.onBook?.("mapscreen", result.row);
                    } else if (result?.kind === "page") {
                        st._homeOverlay = true;
                        st._homeRow = result.row;
                        st.open!(st._state, result.page, st._onClose!, true);
                    } else if (result?.kind === "book") {
                        // GLOSSARY / OPTIONS: the list shuts for good (the pause is over) and the browser opens the book,
                        // which brings the list back on this row when it closes (web/game.js openBook).
                        st._finish!(false);
                        opts.onBook?.(result.book, result.row);
                    } else st._finish!(false);
                } else if (st._homeFlow && !session.transition()) {
                    readBack(session);
                    st.open!(st._state, "home", st._onClose!, true);
                } else st._finish!(true);
                return;
            }
        }
    };

    st.draw = (ctx, viewW = 320, viewH = viewW * 0.75) => {
        if (!st._open || !st._session) return;
        const session = st._session;
        ctx.save();
        ctx.scale(viewW / 320, viewW / 320);
        // The pause home is look C (web/ui-c): the scope turns the clips and text it claims into DOM parts; every other page is still pixels.
        const screen = pickPauseScreen(session.draw.calls, st._entry);
        uiC.scope(st._uiKey, ctx, { enable: !!screen, compose: screen?.compose, dim: dimOf(session.quads) },
            () => paintNativeSession(ctx, renderer, session, { fade: false }));
        for (const q of session.quads) {
            // The fade is a subtractive quad whose grey level is how far the screen has darkened.
            ctx.fillStyle = q.semiTransparent ? `rgba(0,0,0,${q.r / 255})` : `rgb(${q.r},${q.g},${q.b})`;
            ctx.fillRect(q.x, q.y, q.w, q.h);
        }
        ctx.restore();
    };

    st.close = () => { if (st._open) st._finish!(false); };

    st._finish = (commit = true) => {
        if (!st._open) return;
        st._open = false;
        uiC.hide(st._uiKey);
        ++st._request;
        const session = st._session;
        st._session = null;
        let launch = null;
        if (session) {
            if (commit) readBack(session);
            launch = session.transition();
        }
        const cb = st._onClose;
        st._onClose = null;
        // A page that launched another screen (CARD FOLDERS -> the album or the
        // folder editor) keeps its close callback: that screen's end brings the
        // STATUS screen back, and reopenPage re-opens the page with it.
        st._returnClose = launch ? cb : null;
        cb?.();
        // A CARD FOLDERS choice hands off to the album (0x1200) or deck editor (0x400); the
        // caller opens the walker's own screen, which returns to the pause menu.
        if (launch) opts.onTransition?.(launch.id, launch.arg);
    };

    /** Apply what the pages wrote, once, on close: money, the bag, the party order and each
     *  partner's stats and worn gear. The commit itself is the one shared routine both
     *  pause routes call (engine/dw3/ui/pause-close-commit.ts); this hands it the
     *  numbers the session's own snapshot holds. */
    function readBack(session: PauseRootSession) {
        const state = st._state;
        if (!state) return;
        const snap = session.snapshot();
        // The element values partySeed handed the page: species base + elemBonuses.
        // The record's element block carries that base, so the fold needs the value
        // the page OPENED with to measure the rise the chip made. Keyed by ROSTER
        // SLOT — the commit folds each pedestal's record against the slot that record
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
            money: snap.money,
            inventory: snap.inventory,
            partyMap: snap.partyMap,
            formId: (value: number) => (ui as EngineUi).nativeFormIds(session.mem).idByValue.get(value),
            openedElements,
            storage: typeof localStorage !== "undefined" ? localStorage : null,
            recordAt: (rosterSlot: number) => snap.records[rosterSlot] ?? null,
        });
    }

    st.diagnostics = () => ({
        open: st._open, pending: st._open && !st._session, error: st._error?.message ?? null,
        entry: st._entry, packed: { ...st._packed },
        tasks: st._session?.tree.tasks.size ?? 0,
        page: st._session?.pageObject() ?? 0,
        classes: st._session ? [...st._session.tree.tasks.values()].map((t) => t.classId) : [],
        transition: st._session?.transition() ?? null,
        renderer: renderer.stats,
        lastDiagnostic: st._lastDiagnostic,
    });
    return st;
}
