// Browser adapter for the translated in-battle Digivolve form list. The list's
// logic runs in engine/dw3/ui (FightFormSession); this file loads its data and
// hands that and its own seed/answer/diagnostics to
// web/battle-menu-adapter.js, which runs the open/press/update/draw/close
// machinery every battle menu shares. It never executes original instructions
// and never requests an executable asset. `?legacyFormList=1` keeps the walker's
// hand-drawn list (web/battle.js drawFormMenu).
//
// Same public API as createBattleTechTranslated:
// open/update/draw/close/press/isOpen/isPending/active/failed/chosen/
// preload/diagnostics.
import { ui } from "./vendor/engine.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { createBattleMenuAdapter } from "./battle-menu-adapter.js";
import { fetchBytes, fetchJson, loadProfileRecords, loadResidentResources, RESIDENT_PACK_NAMES, RESIDENT_PACKS } from "./resident-data.js";

// The panel's chrome is pack handle 0x00455000 (PGFGTC00) and its icons
// 0x00286000 (CMFONT); the list model's marker strip is the same one the TECH
// list blits (the shared list model F0x8009AF4C is the same object).
const BANKS = [0x4e, 0x7f, 0xa2];
const DATA_LABEL = "Battle form data";

let dataPromise = null;
function loadData() {
    dataPromise ??= Promise.all([
        fetchJson("battlecmd/manifest.json", DATA_LABEL),
        fetchBytes("battlecmd/form-tables.bin", DATA_LABEL),
        fetchBytes("battlecmd/strip.bin", DATA_LABEL),
        // The disc's own 55 profile records at 0x8003EF5C, the same shared slice
        // the DNA pane reads: the list's current form and every row's name and
        // base stats come out of that table.
        loadProfileRecords(DATA_LABEL),
        loadResidentResources().then((shared) => ({ font: shared.font, cursorGlyphs: shared.cursorGlyphs })),
        ...BANKS.flatMap((bank) =>
            Array.from({ length: 7 }, (_, language) => fetchBytes(`battlecmd/${bank + language}.bin`, DATA_LABEL))),
    ]).then(([manifest, tables, strip, profiles, shared, ...bankBytes]) => ({
        manifest, tables, strip, profiles, font: shared.font, cursorGlyphs: shared.cursorGlyphs,
        banks: new Map(BANKS.flatMap((bank, i) =>
            Array.from({ length: 7 }, (_, language) => [bank + language, bankBytes[i * 7 + language]]))),
    })).catch((error) => { dataPromise = null; throw error; });
    return dataPromise;
}

export function createBattleFormTranslated(sfx = null, options = {}) {
    return createBattleMenuAdapter({
        renderer: createNativeScreenRenderer({ packs: RESIDENT_PACKS, pack: "pgfgc00" },
            (directory) => RESIDENT_PACK_NAMES[directory >>> 0] ?? null),
        sfx,
        options,
        load: () => loadData(),
        loadFailure: "battle form data failed to load",
        failureMessage: "translated form list failed",
        failureConsole: "Translated battle form list failed",
        languageError: "Battle form language index is invalid",
        // The queue is deliberately two deep here — a burst of key events must not
        // turn into a burst of menu moves seconds later, and the screen only ever
        // reads one press per display tick anyway. The other lists take sixteen.
        queueLimit: 2,

        /** Open on one party member's four forms. */
        seed: (r, seed = {}) => ({
            activeIndex: Math.max(0, Math.min(2, Number(seed.activeIndex ?? 0) | 0)),
            slotIndex: Number(seed.slotIndex ?? 0) | 0,
            currentSpecies: Number(seed.currentSpecies ?? 1) & 0xffff,
            liveSpecies: Number(seed.liveSpecies ?? 1) & 0xffff,
            reservedForm: Number(seed.reservedForm ?? 0) & 0xff,
            rosterSlots: (seed.rosterSlots ?? []).map((v, i) => (Number.isInteger(Number(v)) ? Number(v) : i) | 0),
            options: (seed.options ?? []).map((option) => ({
                species: Number(option.species ?? 0) & 0xffff,
                left: (option.left ?? []).map((v) => Number(v) & 0xffff),
                right: (option.right ?? []).map((v) => Number(v) & 0xffff),
                techs: (option.techs ?? []).map((v) => Number(v) & 0xffff),
                level: Number(option.level ?? 0) & 0xff,
                dvexp: Number(option.dvexp ?? 0) >>> 0,
            })),
            // get_equipped's triple in slot order, -1 for an empty slot.
            equipped: (seed.equipped ?? []).slice(0, 3).map((v) =>
                (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : -1) & 0xffff),
            panelBlock: (seed.panelBlock ?? []).map((v) => Number(v) & 0xffff),
            preselected: Number(seed.preselected ?? 0) & 0xffff,
        }),

        start: (r, data, language, playSound) => new ui.FightFormSession(language, {
            activeIndex: r._seed.activeIndex,
            slotIndex: r._seed.slotIndex,
            currentSpecies: r._seed.currentSpecies,
            liveSpecies: r._seed.liveSpecies,
            reservedForm: r._seed.reservedForm,
            rosterSlots: r._seed.rosterSlots,
            options: r._seed.options,
            equipped: r._seed.equipped,
            panelBlock: r._seed.panelBlock,
            preselected: r._seed.preselected,
        }, { tables: data.tables, profiles: data.profiles, font: data.font, banks: data.banks,
             ...(data.cursorGlyphs ? { cursorGlyphs: data.cursorGlyphs } : {}) }, { playSound }),

        answer: (r, session) => {
            if (!session.finished()) return null;
            const chosen = session.chosen();
            r._chosen = chosen;
            return { value: chosen };
        },

        /**
         * A screen that threw owns nothing: drop its session so draw() stops
         * painting a frozen panel over the walker's own list, which is what the
         * Digivolve phase falls back to once failed() is true (web/battle.js
         * handleKey PLAYER_DV, draw PLAYER_DV).
         */
        onFail: (r) => {
            const session = r._session;
            r._session = null;
            r._queue.length = 0;
            r._pulse = null;
            r._releaseTicks = 0;
            if (session) session.dispose();
        },

        diagnostics: (r) => ({
            ticks: r._ticks,
            selection: r._session?.selection() ?? null,
            page: r._session?.page() ?? null,
            rows: r._session?.rows() ?? null,
            panelBlock: r._session?.panelBlock() ?? null,
            panelRows: r._session?.panelRows() ?? null,
            panelHeadline: r._session?.panelHeadline() ?? null,
            species: r._session?.rowSpecies() ?? null,
            ready: r._session?.ready() ?? false,
            tasks: r._session?.tree.tasks.size ?? 0,
            vsync: r._session?.vsyncInstalled() ?? false,
            moves: r._session?.moves.map((m) => ({ ...m })) ?? [],
            sounds: r._session?.sounds ?? [],
        }),

        /** The disc's own profile table this screen reads, for the callers that
         *  need the same row lookup (web/battle.js formProfileRow). */
        extraApi: (r) => {
            r.tables = () => (r._data ? { profiles: r._data.profiles } : null);
        },
    });
}
