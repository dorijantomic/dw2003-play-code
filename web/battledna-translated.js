// Browser adapter for the translated in-battle DNA screen. The screen's logic
// runs in engine/dw3/ui (FightDnaSession: the shared partner list, reused from
// the TAG port, then the DNA pane). This file loads its data and hands that and
// its own seed/answer/diagnostics to web/battle-menu-adapter.js, which runs the
// open/press/update/draw/close machinery every battle menu shares. It never
// executes original instructions and never requests an executable asset.
// `?legacyDnaList=1` keeps the walker's own Switch / DNA DV pane
// (web/battle.js drawDnaChoice).
//
// Same public API as createBattleTagTranslated:
// open/update/draw/close/press/isOpen/isPending/active/failed/chosen/
// preload/diagnostics.
import { ui } from "./vendor/engine.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { createBattleMenuAdapter, battleMenuLanguage } from "./battle-menu-adapter.js";
import { fetchBytes, fetchJson, loadProfileRecords, loadResidentResources, RESIDENT_PACK_NAMES, RESIDENT_PACKS } from "./resident-data.js";

// The chrome is 0x00455000 (PGFGTC00, disc 1109). The original builds the
// handle with `lui $a0, 0x455` (fightstg.s:21516).
// Bank 0x7F is the battle UI bank (battlecmd/); bank 0x4E is the Digimon-name
// bank (wizard/). The pane asks [0x80044F4C](language + 0x7F) for "Switch",
// "DNA DV", "MP" and "/", and (language + 0x4E) for a species name indexed by
// the profile record's +0x55 byte.
const UI_BANK = 0x7f;
const NAME_BANK = 0x4e;
// The carry-over panel's technique names live in bank 0xA2, the same extracted
// bank the Digivolve form list reads.
const TECH_BANK = 0xa2;
const BANK_DIRS = [[UI_BANK, "battlecmd"], [NAME_BANK, "wizard"]];
const DATA_LABEL = "Battle DNA data";
// The pane's three data blocks live in pro/fightstg's own image: the species strip's
// eight-word config at 0x800A3594 and the option list's at 0x800A35B4, then the four
// MP-plate x anchors at 0x800A35D4 (fightstg.s:33969-33988, read out of
// engine/dw3/ui/native/battle-dna-menu.ts). The data build copies those 0x50 bytes
// and nothing else into battlecmd/dna-tables.bin, so no screen loads the overlay.
// The overlay itself is one image loaded once at battle setup (fieldstg.s:7568-756c,
// resource 0x167), which is why this data is fetched with the rest of the battle's at
// battle start rather than when the pane opens.
const DNA_TABLES_SIZE = 0x50;
// tech-tables.bin is the TECH screen's config block, the vsync blit rectangle
// and then the exe's 18-byte technique records from 0x80042BDC, which is where
// the pane reads the Jogress MP price from.
const TECH_TABLES_ICON_OFFSET = 40;
// form-tables.bin is the Digivolve form list's block: its config, the marker
// blit rectangle, then the 40 bytes of 0x800A350C that place the carry-over
// panel's thirteen page-zero numbers. The DNA pane shows that same panel, so it
// reads the same extracted bytes rather than a second copy of the table.
const FORM_PANEL_PAGE0_OFFSET = 40;
const FORM_PANEL_PAGE0_SIZE = 40;

/** The Digimon profile table the pane reads, 0x8003EF5C + 0x58*row, is the one
 * shared cut every screen showing a Digimon loads (`loadProfileRecords`,
 * resident-data.js), so the pause pages, the fight report, the tag list, the gym, the
 * lab and the form list all resolve the same bytes. */
const fetchProfileTable = () => loadProfileRecords(DATA_LABEL);

let dataPromise = null;
function loadData(language) {
    dataPromise ??= Promise.all([
        fetchJson("battlecmd/manifest.json", DATA_LABEL),
        fetchBytes("battlecmd/dna-tables.bin", DATA_LABEL),
        fetchBytes("battlecmd/tag-tables.bin", DATA_LABEL),
        fetchBytes("battlecmd/tech-tables.bin", DATA_LABEL),
        fetchBytes("battlecmd/form-tables.bin", DATA_LABEL),
        fetchBytes("battlecmd/strip.bin", DATA_LABEL),
        fetchProfileTable(),
        loadResidentResources().then((shared) => ({ font: shared.font, cursorGlyphs: shared.cursorGlyphs })),
        ...BANK_DIRS.map(([bank, dir]) => fetchBytes(`${dir}/${bank + language}.bin`, DATA_LABEL)),
        // Bank 0xA2 is the technique-name bank the carry-over panel's technique
        // pages read; it lives beside the battle command banks on the disc.
        fetchBytes(`battlecmd/${TECH_BANK + language}.bin`, DATA_LABEL),
    ]).then(([manifest, tables, tagTables, techTables, formTables, strip, profiles, shared, uiBank, nameBank, techBank]) => {
        if (tables.length !== DNA_TABLES_SIZE) throw new Error("dna-tables.bin does not carry the pane's three blocks");
        const panelTable = formTables.subarray(FORM_PANEL_PAGE0_OFFSET, FORM_PANEL_PAGE0_OFFSET + FORM_PANEL_PAGE0_SIZE);
        if (panelTable.length !== FORM_PANEL_PAGE0_SIZE) throw new Error("form-tables.bin does not carry the panel number table");
        return {
            manifest, tables,
            tagTables,
            panelTable,
            techniques: techTables.subarray(TECH_TABLES_ICON_OFFSET),
            profiles,
            strip, font: shared.font, cursorGlyphs: shared.cursorGlyphs,
            banks: new Map([
                [UI_BANK + language, uiBank],
                [NAME_BANK + language, nameBank],
                [TECH_BANK + language, techBank],
            ]),
        };
    }).catch((error) => { dataPromise = null; throw error; });
    return dataPromise;
}

export function createBattleDnaTranslated(sfx = null, options = {}) {
    return createBattleMenuAdapter({
        renderer: createNativeScreenRenderer({ packs: RESIDENT_PACKS, pack: "pgfgc00" },
            (directory) => RESIDENT_PACK_NAMES[directory >>> 0] ?? null),
        sfx,
        options,
        state: { _answer: null, _species: null, _language: 2 },
        // The banks are cut per language, so the language is settled before the
        // data is asked for and the screen's own copy is what start() uses.
        beforeLoad: (r) => { r._language = battleMenuLanguage(options, "Battle DNA language index is invalid"); },
        load: (r) => loadData(r._language),
        loadFailure: "battle DNA data failed to load",
        failureMessage: "translated DNA screen failed",
        failureConsole: "Translated battle DNA screen failed",
        languageError: "Battle DNA language index is invalid",
        chosenField: false,
        readChosen: (r) => r._answer,

        /**
         * Open the DNA screen. `seed.step` picks the first step: "list" runs the
         * shared partner list in DNA mode, "pane" (the default) opens the pane on
         * the partner the caller already picked.
         */
        seed: (r, seed = {}) => ({
            step: seed.step === "list" ? "list" : "pane",
            activeIndex: Math.max(0, Math.min(2, Number(seed.activeIndex ?? 0) | 0)),
            partnerIndex: Math.max(0, Math.min(2, Number(seed.partnerIndex ?? 1) | 0)),
            members: (seed.members ?? []).map((m, i) => ({
                digimonId: Number(m.digimonId ?? 0) & 0xffff,
                // The roster slot F0x80016D94 answers for a party position. A
                // harness that does not model the roster answers the position
                // itself, which is all the original's map holds anyway.
                rosterSlot: Number(m.rosterSlot ?? i) & 0xff,
                hp: Number(m.hp ?? 0) & 0xffff,
                maxHp: Number(m.maxHp ?? 0) & 0xffff,
                mp: Number(m.mp ?? 0) & 0xffff,
                maxMp: Number(m.maxMp ?? 0) & 0xffff,
                status: Number(m.status ?? 0) & 0xff,
                blast: !!m.blast,
                panel: m.panel ?? null,
                forms: m.forms ?? null,
                preselected: Number(m.preselected ?? 0) & 0xffff,
            })),
        }),

        onOpen: (r) => {
            r._answer = null;
            r._species = null;
            r._ticks = 0;
        },

        start: (r, data, language, playSound) => new ui.FightDnaSession(r._language, {
            ...r._seed,
        }, {
            tables: data.tagTables,
            dnaTables: data.tables,
            panelTable: data.panelTable,
            profiles: data.profiles,
            font: data.font,
            techniques: data.techniques,
            banks: data.banks,
            ...(data.cursorGlyphs ? { cursorGlyphs: data.cursorGlyphs } : {}),
        }, { playSound }, r._seed.step === "list"),

        // The pane does not close itself on a confirm: it writes the answer word
        // and steps back to the species names (fightstg.s:22300-22312,
        // `self+0x2c(self, 0)`), and the coordinator is what closes it. So the
        // answer is read off that word, and the cancel is the word -2 the pane
        // leaves behind when it does close itself.
        answer: (r, session) => {
            const pane = session.pane;
            if (session.step() === "done") {
                r._answer = pane ? pane.answer() : -2;
                r._species = pane ? pane.speciesOut() : null;
                return { value: r._answer };
            }
            if (pane && r._answer === null) {
                const word = pane.answer();
                if (word !== -1) {
                    r._answer = word;
                    r._species = pane.speciesOut();
                    return { value: word };
                }
            }
            return null;
        },

        // The pane keeps reading the pad after its confirm, until it is done.
        canQueue: (r, session) => !!session && session.step() !== "done",
        done: (session) => session.step() === "done",
        paintTarget: (r) => (r._session.step() === "pane" ? r._session.pane : r._session.list),

        /**
         * The two extracted tables the DNA command's own rule reads, once the
         * preload has landed: the 55 profile records at 0x8003EF5C and the 18-byte
         * technique records at 0x80042BDC. The pane has them in its memory; the
         * battle command path reads the SAME bytes through the shared rule in
         * engine/dw3/ui/native/battle-dna-menu.ts, so one pairing answer serves both.
         */
        extraApi: (r) => {
            /** The DNA result species the confirm wrote through self+0x80. */
            r.speciesOut = () => r._species;
            r.tables = () => (r._data ? { profiles: r._data.profiles, techniques: r._data.techniques } : null);
        },

        diagnostics: (r) => {
            const pane = r._session?.pane ?? null;
            const list = r._session?.list ?? null;
            return {
                step: r._session?.step() ?? null,
                answer: r._answer,
                speciesOut: r._species,
                ticks: r._ticks,
                list: list ? {
                    rows: list.rows(), selection: list.selection(),
                    candidates: list.candidates(), panels: list.panels(),
                    ready: list.ready(), chosen: list.chosen(),
                } : null,
                pane: pane ? {
                    subState: pane.subState(), ready: pane.ready(),
                    species: pane.species(), stripCursor: pane.stripCursor(),
                    previewOption: pane.previewOption(), optionRow: pane.optionRow(),
                    selected: pane.selected(),
                    dnaId: pane.dnaId(), price: pane.price(),
                    combatant: pane.combatant(),
                    handoffs: pane.handoffs.map((h) => ({ ...h })),
                    preview: pane.preview(),
                    sounds: pane.sounds, tasks: pane.tree.tasks.size,
                    vsync: pane.vsyncInstalled(),
                    party: [0, 1, 2].map((slot) => ({ slot, ...pane.partyStatus(slot) })),
                } : null,
            };
        },
    });
}
