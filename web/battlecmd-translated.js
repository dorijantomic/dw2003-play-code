// Browser adapter for the translated battle command list (Fight / Tech / DV /
// Tag / Item / Run). The list's logic runs in engine/dw3/ui (FightCommandSession);
// this file loads its data and hands that and its own seed/answer/diagnostics to
// web/battle-menu-adapter.js, which runs the open/press/update/draw/close
// machinery every battle menu shares, then hands the chosen row back to
// web/battle.js. It never executes original instructions and never requests an
// executable asset. `?nativeBattleCmd=1` keeps the original-code list as a
// research reference (web/battlecmd-native.js); `?legacyBattleCmd=1` keeps the
// walker's hand-made list.
//
// Same public API as createBattleCommandNative: open/update/draw/close/press/
// isOpen/isPending/active/failed/chosen/preload/diagnostics.
//
// The confused player's list is the SAME widget on the original's joke config:
// `seed.jokeIndices` (the shuffle's first six joke indices, from
// engine/dw3/battle-confusion.ts shuffleJokeMenu) opens it as pro/fightstg's
// joke owner F0x8009A898, whose rows are the eight joke commands 0x6B+index,
// never greyed, and whose confirm answers with the chosen joke row instead of a
// command. `?legacyJokeMenu=1` (read by web/battle.js) keeps the walker's own
// hand-drawn list for that case.
import { ui } from "./vendor/engine.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { createBattleMenuAdapter } from "./battle-menu-adapter.js";
import { fetchBytes, fetchJson, loadResidentResources } from "./resident-data.js";

/** The row picture pack: handle 0x04550000 is disc index 1109, PGFGTC00. */
const PACKS = { 1109: "pgfgc00" };
const NAME_BANK = 0x7f;
// The command list takes the four directions and the four face buttons only;
// the two shoulder buttons and start/select are not rows here.
const PULSE_BUTTONS = new Set(["up", "down", "left", "right", "circle", "cross", "triangle", "square", "start", "select"]);

const DATA_LABEL = "Battle command data";

let dataPromise = null;
function loadData() {
    dataPromise ??= Promise.all([
        fetchJson("battlecmd/manifest.json", DATA_LABEL),
        fetchBytes("battlecmd/tables.bin", DATA_LABEL),
        fetchBytes("battlecmd/strip.bin", DATA_LABEL),
        loadResidentResources().then((shared) => ({ font: shared.font, cursorGlyphs: shared.cursorGlyphs })),
        ...Array.from({ length: 7 }, (_, language) => fetchBytes(`battlecmd/${NAME_BANK + language}.bin`, DATA_LABEL)),
    ]).then(([manifest, tables, strip, shared, ...banks]) => ({
        manifest, tables, strip, font: shared.font, cursorGlyphs: shared.cursorGlyphs,
        banks: new Map(banks.map((data, language) => [NAME_BANK + language, data])),
    })).catch((error) => { dataPromise = null; throw error; });
    return dataPromise;
}

/**
 * The acting member's ailment byte (record +0x1C): 0x01 Poison, 0x02 Frozen,
 * 0x04 Confusion, 0x08 Sleep, 0x10 the cannot-flee lock, 0x20 the
 * cannot-digivolve lock. The two locks are set by FIGHTSTG_F0x8009cd1c with the
 * record's own bits (`ori $v0, 0x10` :27134 / `ori $v0, 0x20` :27141) and cleared
 * by the pool's expiry (`pro/wfightmn.s:2743-:2773`); the walker keeps them as
 * per-record booleans, so the byte the escape roll, the command-menu row greys
 * (F0x80093cf4 :17595) and the DNA tests read carries them too.
 */
export function battleAilmentByte(member) {
    if (Number.isInteger(member?.statusBits)) return member.statusBits & 0xff;
    const a = member?.ailments ?? {};
    return (a.poison ? 0x01 : 0) | (a.frozen ? 0x02 : 0) | (a.confuse ? 0x04 : 0) | (a.sleep ? 0x08 : 0)
        | (member?.cantFlee ? 0x10 : 0) | (member?.cantDigivolve ? 0x20 : 0);
}

export function createBattleCommandTranslated(sfx = null, options = {}) {
    return createBattleMenuAdapter({
        renderer: createNativeScreenRenderer({ pack: "pgfgc00", packs: PACKS },
            (directory) => PACKS[directory >>> 16] ?? null),
        sfx,
        options,
        load: () => loadData(),
        loadFailure: "battle command data failed to load",
        failureMessage: "translated command list failed",
        failureConsole: "Translated battle command list failed",
        languageError: "Battle command language index is invalid",
        pulseButtons: PULSE_BUTTONS,
        countPresses: true,
        state: { _row: 0, _pulseTicks: 0, _presses: 0 },

        /** Open at `initialRow`; `seed` carries the acting party slot, its ailment byte
         *  and, when the acting Digimon is confused, the shuffle's six joke indices. */
        seed: (r, initialRow = 0, seed = {}) => {
            r._row = Math.max(0, Math.min(5, Number(initialRow) | 0));
            const joke = seed.jokeIndices ?? null;
            return {
                activeIndex: Math.max(0, Math.min(2, Number(seed.activeIndex) | 0)),
                ailmentBits: Number(seed.ailmentBits) & 0xff,
                jokeIndices: joke && joke.length === 6 ? joke.map((v) => Number(v) | 0) : null,
            };
        },

        onOpen: (r) => { r._pulseTicks = 0; },

        start: (r, data, language, playSound) => {
            const joke = r._seed.jokeIndices;
            return new ui.FightCommandSession(language, {
                // The joke owner always opens on its first row (F0x8009AB74 stores 0).
                initialRow: joke ? 0 : r._row,
                activeIndex: r._seed.activeIndex,
                ailmentBits: r._seed.ailmentBits,
                // FIGHTSTG_F0x8009A2DC adds 0x6B to the shuffled table's entry per row.
                jokeLabels: joke ? joke.map((index) => (Number(index) | 0) + ui.JOKE_LABEL_BASE) : null,
            }, { tables: data.tables, font: data.font, banks: data.banks,
                 ...(data.cursorGlyphs ? { cursorGlyphs: data.cursorGlyphs } : {}) }, { playSound });
        },

        // The joke owner closes itself on the confirm and answers with the chosen
        // joke; the command actor writes its out word instead.
        answer: (r, session) => {
            const joke = session.joke();
            if (joke !== null) {
                r._chosen = joke;
                return { value: joke };
            }
            if (!session.finished()) return null;
            r._chosen = session.chosen();
            return { value: r._chosen };
        },

        diagnostics: (r) => ({
            row: r._row,
            presses: r._presses,
            ticks: r._ticks,
            selection: r._session?.selection() ?? null,
            ready: r._session?.ready() ?? false,
            joke: r._session?.joke() ?? null,
            tasks: r._session?.tree.tasks.size ?? 0,
            vsync: r._session?.vsyncInstalled() ?? false,
            moves: r._session?.moves.map((m) => ({ ...m })) ?? [],
        }),
    });
}
