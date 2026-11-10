// Browser adapter for the translated in-battle TECH list. The list's logic runs
// in engine/dw3/ui (FightTechSession); this file loads its data and hands that
// and its own seed/answer/diagnostics to web/battle-menu-adapter.js, which runs
// the open/press/update/draw/close machinery every battle menu shares. It never
// executes original instructions and never requests an executable asset.
// `?legacyTechList=1` keeps the walker's hand-drawn list
// (web/battle.js drawTechMenu).
//
// Same public API as createBattleCommandTranslated:
// open/update/draw/close/press/isOpen/isPending/active/failed/chosen/
// preload/diagnostics.
import { ui } from "./vendor/engine.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { createBattleMenuAdapter } from "./battle-menu-adapter.js";
import { fetchBytes, fetchJson, loadResidentResources, RESIDENT_PACK_NAMES, RESIDENT_PACKS } from "./resident-data.js";

// The row icon is pack handle 0x00286000 (CMFONT, the resident UI glyphs) and
// the chrome is 0x00455000 (PGFGTC00, disc 1109). The original builds both
// handles with `lui $a0, 0x286` / `lui $a0, 0x455` (fightstg.s:19748, :19760).
const BANKS = [0x7f, 0x9b, 0xa2];
const DATA_LABEL = "Battle tech data";

let dataPromise = null;
function loadData() {
    dataPromise ??= Promise.all([
        fetchJson("battlecmd/manifest.json", DATA_LABEL),
        fetchBytes("battlecmd/tech-tables.bin", DATA_LABEL),
        fetchBytes("battlecmd/strip.bin", DATA_LABEL),
        loadResidentResources().then((shared) => ({ font: shared.font, cursorGlyphs: shared.cursorGlyphs })),
        ...BANKS.flatMap((bank) =>
            Array.from({ length: 7 }, (_, language) => fetchBytes(`battlecmd/${bank + language}.bin`, DATA_LABEL))),
    ]).then(([manifest, tables, strip, shared, ...bankBytes]) => ({
        manifest, tables, strip, font: shared.font, cursorGlyphs: shared.cursorGlyphs,
        banks: new Map(BANKS.flatMap((bank, i) =>
            Array.from({ length: 7 }, (_, language) => [bank + language, bankBytes[i * 7 + language]]))),
    })).catch((error) => { dataPromise = null; throw error; });
    return dataPromise;
}

export function createBattleTechTranslated(sfx = null, options = {}) {
    return createBattleMenuAdapter({
        renderer: createNativeScreenRenderer({ packs: RESIDENT_PACKS, pack: "pgfgc00" },
            (directory) => RESIDENT_PACK_NAMES[directory >>> 0] ?? null),
        sfx,
        options,
        load: () => loadData(),
        loadFailure: "battle tech data failed to load",
        failureMessage: "translated TECH list failed",
        failureConsole: "Translated battle TECH list failed",
        languageError: "Battle tech language index is invalid",

        /** Open on the party member's technique list. */
        seed: (r, seed = {}) => ({
            activeIndex: Math.max(0, Math.min(2, Number(seed.activeIndex ?? 0) | 0)),
            mp: Number(seed.mp ?? 0) & 0xffff,
            maxMp: Number(seed.maxMp ?? 0) & 0xffff,
            noCharge: Number(seed.noCharge ?? 0) & 0xff,
            techniques: (seed.techniques ?? []).map((t) => ({ word: Number(t.word ?? 0) & 0xffff, cost: Number(t.cost ?? 0) | 0 })),
        }),

        start: (r, data, language, playSound) => new ui.FightTechSession(language, {
            activeIndex: r._seed.activeIndex,
            mp: r._seed.mp,
            maxMp: r._seed.maxMp,
            noCharge: r._seed.noCharge,
            techniques: r._seed.techniques,
        }, { tables: data.tables, font: data.font, banks: data.banks,
             ...(data.cursorGlyphs ? { cursorGlyphs: data.cursorGlyphs } : {}) }, { playSound }),

        answer: (r, session) => {
            if (!session.finished()) return null;
            const chosen = session.chosen();
            r._chosen = chosen;
            return { value: chosen };
        },

        diagnostics: (r) => ({
            ticks: r._ticks,
            selection: r._session?.selection() ?? null,
            page: r._session?.page() ?? null,
            rows: r._session?.rows() ?? null,
            ready: r._session?.ready() ?? false,
            tasks: r._session?.tree.tasks.size ?? 0,
            vsync: r._session?.vsyncInstalled() ?? false,
            moves: r._session?.moves.map((m) => ({ ...m })) ?? [],
            sounds: r._session?.sounds ?? [],
        }),
    });
}
