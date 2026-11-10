// Browser adapter for the translated in-battle ITEM list. The list's logic runs
// in engine/dw3/ui (FightItemSession); this file loads its data and hands that
// and its own seed/answer/diagnostics to web/battle-menu-adapter.js, which runs
// the open/press/update/draw/close machinery every battle menu shares. It never
// executes original instructions and never requests an executable asset.
// `?legacyItemList=1` keeps the walker's hand-drawn list
// (web/battle.js drawItemMenu).
//
// Same public API as createBattleCommandTranslated:
// open/update/draw/close/press/isOpen/isPending/active/failed/chosen/
// preload/diagnostics.
import { ui } from "./vendor/engine.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { createBattleMenuAdapter } from "./battle-menu-adapter.js";
import { fetchBytes, fetchJson, loadResidentResources, RESIDENT_PACK_NAMES, RESIDENT_PACKS } from "./resident-data.js";
import { itemIconClip } from "./itemicons.js";

// The row icon is pack handle 0x00286000 (CMFONT, the resident UI glyphs) and
// the chrome is 0x00455000 (PGFGTC00, disc 1109): the original builds both
// handles with `lui $a0, 0x286` / `lui $a0, 0x455` (fightstg.s:19096, :19130).
// Bank 0x7F is the battle command data's own; the item names (0x6A) and the
// item descriptions (0x63) are the merchant screens' shared banks, already
// extracted (web/assets/data/shop-banks).
const BANKS = [0x7f, 0x6a, 0x63];
const SHOP_BANK_DIRS = { 0x7f: "battlecmd", 0x6a: "shop-banks", 0x63: "shop-banks" };
const DATA_LABEL = "Battle item data";

let dataPromise = null;
function loadData() {
    dataPromise ??= Promise.all([
        fetchJson("battlecmd/manifest.json", DATA_LABEL),
        // The ITEM config block at 0x800A3534 and TECH's at 0x800A3554 hold the
        // same eight words {1,14,69,14,-1,0,0,0} (fightstg.s:33941-33968), so the
        // shipped TECH table's first 40 bytes are this screen's own bytes too;
        // tests/lane-b/fight-item-menu.test.js pins that equality.
        fetchBytes("battlecmd/tech-tables.bin", DATA_LABEL),
        fetchBytes("battlecmd/strip.bin", DATA_LABEL),
        loadResidentResources().then((shared) => ({ font: shared.font, cursorGlyphs: shared.cursorGlyphs })),
        ...BANKS.flatMap((bank) => {
            const dir = SHOP_BANK_DIRS[bank];
            return Array.from({ length: 7 }, (_, language) => fetchBytes(`${dir}/${bank + language}.bin`, DATA_LABEL));
        }),
    ]).then(([manifest, tables, strip, shared, ...bankBytes]) => ({
        manifest, tables, strip, font: shared.font, cursorGlyphs: shared.cursorGlyphs,
        banks: new Map(BANKS.flatMap((bank, i) =>
            Array.from({ length: 7 }, (_, language) => [bank + language, bankBytes[i * 7 + language]]))),
    })).catch((error) => { dataPromise = null; throw error; });
    return dataPromise;
}

export function createBattleItemTranslated(sfx = null, options = {}) {
    return createBattleMenuAdapter({
        renderer: createNativeScreenRenderer({ packs: RESIDENT_PACKS, pack: "pgfgc00" },
            (directory) => RESIDENT_PACK_NAMES[directory >>> 0] ?? null),
        sfx,
        options,
        load: () => loadData(),
        loadFailure: "battle item data failed to load",
        failureMessage: "translated ITEM list failed",
        failureConsole: "Translated battle ITEM list failed",
        languageError: "Battle item language index is invalid",

        /** Open on the carried items the original's own filter would offer. */
        seed: (r, seed = {}) => ({
            items: (seed.items ?? []).map((item) => ({
                id: Number(item.id ?? 0) & 0xffff,
                qty: Number(item.qty ?? 0) & 0xff,
                // The exe's cel table at 0x80042BA8 is the clip table
                // web/itemicons-data.js ships; itemIconClip is that mapping.
                family: Number(item.family ?? 0) & 0xff,
            })),
        }),

        start: (r, data, language, playSound) => new ui.FightItemSession(language, { items: r._seed.items },
            { tables: data.tables.subarray(0, ui.FIGHT_ITEM_TABLES_SIZE), font: data.font,
                banks: data.banks,
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
            count: r._session?.count() ?? null,
            ids: r._session?.ids() ?? null,
            ready: r._session?.ready() ?? false,
            tasks: r._session?.tree.tasks.size ?? 0,
            vsync: r._session?.vsyncInstalled() ?? false,
            moves: r._session?.moves.map((m) => ({ ...m })) ?? [],
            sounds: r._session?.sounds ?? [],
            icons: r._seed?.items.map((item) => ({ id: item.id, clip: itemIconClip(item.id) })) ?? [],
        }),
    });
}
