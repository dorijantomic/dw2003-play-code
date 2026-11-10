// Browser adapter for the translated in-battle TAG (partner) list. The list's
// logic runs in engine/dw3/ui (FightTagSession); this file loads its data and
// hands that and its own seed/answer/diagnostics to
// web/battle-menu-adapter.js, which runs the open/press/update/draw/close
// machinery every battle menu shares. It never executes original instructions
// and never requests an executable asset. `?legacyTagList=1` keeps the walker's
// hand-drawn list (web/battle.js drawTagMenu).
//
// Same public API as createBattleCommandTranslated:
// open/update/draw/close/press/isOpen/isPending/active/failed/chosen/
// preload/diagnostics.
import { ui, rosterSlotOfCharId } from "./vendor/engine.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { createBattleMenuAdapter } from "./battle-menu-adapter.js";
import { encodeNativeScreenText } from "./native-screen.js";
import { fetchBytes, fetchJson, loadProfileRecords, loadResidentResources, RESIDENT_PACK_NAMES, RESIDENT_PACKS } from "./resident-data.js";

// The chrome is 0x00455000 (PGFGTC00, disc 1109) and the blinking hand is
// 0x00286000 (CMFONT, the resident UI glyphs). The original builds both handles
// with `lui $a0, 0x455` / `lui $a0, 0x286` (fightstg.s:21454 / :20858).
// The tag list's only text bank is the battle UI words (0x7F); each row's NAME
// is the member's OWN record string at DIGIMON_CUR_STATS + slot*0x3DC, reached
// through ctx+0x2718 -> ctx+0x2750, not through a text bank. (The predecessor
// loaded bank 0x4E and read a species word there; that showed the species name
// and lost a renamed partner's name.)
const BANKS = [0x7f];
const DATA_LABEL = "Battle tag data";

let dataPromise = null;
function loadData() {
    dataPromise ??= Promise.all([
        fetchJson("battlecmd/manifest.json", DATA_LABEL),
        fetchBytes("battlecmd/tag-tables.bin", DATA_LABEL),
        fetchBytes("battlecmd/strip.bin", DATA_LABEL),
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

/** The name string the species service hands a row's plate. */
export function createBattleTagTranslated(sfx = null, options = {}) {
    return createBattleMenuAdapter({
        renderer: createNativeScreenRenderer({ packs: RESIDENT_PACKS, pack: "pgfgc00" },
            (directory) => RESIDENT_PACK_NAMES[directory >>> 0] ?? null),
        sfx,
        options,
        load: () => loadData(),
        loadFailure: "battle tag data failed to load",
        failureMessage: "translated TAG list failed",
        failureConsole: "Translated battle TAG list failed",
        languageError: "Battle tag language index is invalid",
        state: { _row: null },

        /** Open on the two partners that are not the acting member. */
        seed: (r, seed = {}) => {
            const state = options.getState?.() ?? {};
            const party = Array.isArray(state.party) ? state.party : [];
            return {
                activeIndex: Math.max(0, Math.min(2, Number(seed.activeIndex ?? 0) | 0)),
                interactive: Number(seed.interactive ?? 1) ? 1 : 0,
                cursorRow: Math.max(0, Math.min(1, Number(seed.cursorRow ?? 0) | 0)),
                // Each row is a party POSITION. The disc seats the member's ROSTER SLOT
                // at ctx+0x70 and names the row from that member's own record, so the
                // adapter resolves the slot from the party's character id and encodes
                // the member's own name (a rename follows; a reorder cannot mis-name).
                members: (seed.members ?? []).map((m, i) => ({
                    digimonId: Number(m.digimonId ?? 0) | 0,
                    hp: Number(m.hp ?? 0) & 0xffff,
                    maxHp: Number(m.maxHp ?? 0) & 0xffff,
                    mp: Number(m.mp ?? 0) & 0xffff,
                    maxMp: Number(m.maxMp ?? 0) & 0xffff,
                    rosterSlot: rosterSlotOfCharId(String(party[i] ?? "")) ?? i,
                    nameBytes: encodeNativeScreenText(String(m.name ?? ""), 23),
                    forms: m.forms,
                    blast: !!m.blast,
                })),
            };
        },

        /** The list resets its chosen row with the rest of the screen. */
        onOpen: (r) => { r._row = null; },

        start: (r, data, language, playSound) => new ui.FightTagSession(language, {
            activeIndex: r._seed.activeIndex,
            interactive: r._seed.interactive,
            cursorRow: r._seed.cursorRow,
            members: r._seed.members,
        }, { tables: data.tables, profiles: data.profiles, font: data.font, banks: data.banks,
             ...(data.cursorGlyphs ? { cursorGlyphs: data.cursorGlyphs } : {}) },
           { playSound }),

        answer: (r, session) => {
            if (!session.finished()) return null;
            r._chosen = session.chosen();
            r._row = session.chosenRow();
            return { value: r._chosen };
        },

        extraApi: (r) => {
            r.chosenRow = () => r._row;
        },

        diagnostics: (r) => ({
            row: r._row,
            ticks: r._ticks,
            selection: r._session?.selection() ?? null,
            rows: r._session?.rows() ?? null,
            candidates: r._session?.candidates() ?? null,
            panels: r._session?.panels() ?? null,
            message: r._session?.messageOpen() ?? false,
            ready: r._session?.ready() ?? false,
            tasks: r._session?.tree.tasks.size ?? 0,
            vsync: r._session?.vsyncInstalled() ?? false,
            moves: r._session?.moves.map((m) => ({ ...m })) ?? [],
            sounds: r._session?.sounds ?? [],
        }),
    });
}
