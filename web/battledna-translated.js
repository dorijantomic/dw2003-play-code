// Browser adapter for the translated in-battle DNA screen. The screen's logic
// runs in engine/dw3/ui (FightDnaSession: the shared partner list, reused from
// the TAG port, then the DNA pane). This file loads its data, forwards the held
// buttons and single presses, paints the picture calls (the PGFGTC00 pane frame,
// the DNA row's backing, the MP plate and the list models' markers) and the
// text widgets, and hands the answer back to web/battle.js. It never executes
// original instructions and never requests an executable asset.
// `?legacyDnaList=1` keeps the walker's own Switch / DNA DV pane
// (web/battle.js drawDnaChoice).
//
// Same public API as createBattleTagTranslated:
// open/update/draw/close/press/isOpen/isPending/active/failed/chosen/
// preload/diagnostics.
import { ui } from "./vendor/engine.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { paintNativeSession } from "./native-session.js";
import { wfightLoaderRegion } from "./wfight-translated.js";
import { fetchBytes, fetchJson, loadProfileRecords, loadResidentResources } from "./resident-data.js";

// The chrome is 0x00455000 (PGFGTC00, disc 1109). The original builds the
// handle with `lui $a0, 0x455` (fightstg.s:21516).
const PACK_NAMES = { 0x02860000: "cmfont", 0x04550000: "pgfgc00" };
const PACKS = { 646: "cmfont", 1109: "pgfgc00" };
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
const PULSE_BUTTONS = new Set(["up", "down", "left", "right", "circle", "cross", "triangle", "square", "l1", "r1", "start", "select"]);
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

/** The 16bpp strip the marker blit copies from, as an opaque canvas. */
function stripCanvas(bytes, w, h) {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    const image = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
        const c = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
        const r = c & 0x1f, gg = (c >> 5) & 0x1f, b = (c >> 10) & 0x1f;
        image.data[i * 4] = (r << 3) | (r >> 2);
        image.data[i * 4 + 1] = (gg << 3) | (gg >> 2);
        image.data[i * 4 + 2] = (b << 3) | (b >> 2);
        image.data[i * 4 + 3] = 0xff;
    }
    g.putImageData(image, 0, 0);
    return canvas;
}

export function createBattleDnaTranslated(sfx = null, options = {}) {
    const r = {
        _open: false, _session: null, _data: null, _error: null, _failed: false,
        _seed: null, _clock: null, _queue: [], _strip: null, _stripSource: null,
        _ticks: 0, _answer: null, _species: null, _lastDiagnostic: null,
        _releaseTicks: 0, _pulse: null, _language: 2,
    };
    const renderer = createNativeScreenRenderer({ packs: PACKS, pack: "pgfgc00" },
        (directory) => PACK_NAMES[directory >>> 0] ?? null);

    const playSound = (id) => { sfx?.playPacked(id); };

    function fail(error) {
        r._error = error;
        r._failed = true;
        r._lastDiagnostic = `translated DNA screen failed: ${error?.message ?? error}`;
        console.error("Translated battle DNA screen failed", error);
    }

    function language() {
        const state = options.getState?.() ?? {};
        const selected = state.languageByte;
        const value = Number.isInteger(selected) ? selected : 2;
        if (value < 0 || value > 6) throw new Error("Battle DNA language index is invalid");
        return value;
    }

    r.preload = () => {
        try { r._language = language(); } catch (error) { fail(error); return; }
        loadData(r._language).then((data) => { r._data = data; }).catch((error) => {
            r._lastDiagnostic = `battle DNA data failed to load: ${error?.message ?? error}`;
        });
    };

    /**
     * Open the DNA screen. `seed.step` picks the first step: "list" runs the
     * shared partner list in DNA mode, "pane" (the default) opens the pane on
     * the partner the caller already picked.
     */
    r.open = (seed = {}) => {
        r._open = true;
        r._seed = {
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
        };
        r._answer = null;
        r._species = null;
        r._strip = null;
        r._session = null;
        r._queue.length = 0;
        r._pulse = null;
        r._releaseTicks = 0;
        r._ticks = 0;
        r._lastDiagnostic = null;
        if (!r._data) r.preload();
    };

    r.isOpen = () => r._open && !r._failed;
    r.isPending = () => r._open && !r._session && !r._failed;
    r.active = () => r._open && !!r._session;
    r.failed = () => r._failed;
    /** The answer word: -2 for a cancel, else the row in the low nibble. */
    r.chosen = () => r._answer;
    /** The DNA result species the confirm wrote through self+0x80. */
    r.speciesOut = () => r._species;
    /**
     * The two extracted tables the DNA command's own rule reads, once the
     * preload has landed: the 55 profile records at 0x8003EF5C and the 18-byte
     * technique records at 0x80042BDC. The pane has them in its memory; the
     * battle command path reads the SAME bytes through the shared rule in
     * engine/dw3/ui/native/battle-dna-menu.ts, so one pairing answer serves both.
     */
    r.tables = () => (r._data ? { profiles: r._data.profiles, techniques: r._data.techniques } : null);

    /** A key event as a single press: held for one display tick, then released. */
    r.press = (button) => {
        if (!PULSE_BUTTONS.has(button)) return;
        r._queue.push(button);
        if (r._queue.length > 16) r._queue.shift();
    };

    function buttonsForTick(held) {
        const buttons = new Set(held);
        if (r._releaseTicks > 0) {
            r._releaseTicks--;
            r._pulse = null;
        } else if (r._session && r._session.step() !== "done" && r._queue.length > 0) {
            r._pulse = r._queue.shift();
            buttons.add(r._pulse);
            r._releaseTicks = 1;
        }
        return buttons;
    }

    /**
     * One battle update. The pane does not close itself on a confirm: it writes
     * the answer word and steps back to the species names (fightstg.s:22300-
     * 22312, `self+0x2c(self, 0)`), and the coordinator is what closes it. So the
     * answer is read off that word, and the cancel is the word -2 the pane leaves
     * behind when it does close itself.
     */
    r.update = (keys, dt = 1 / 60) => {
        if (!r._open || r._failed) return null;
        if (!r._session) {
            if (!r._data) {
                if (!dataPromise) r.preload();
                return null;
            }
            try {
                r._session = new ui.FightDnaSession(r._language, r._seed, {
                    tables: r._data.tagTables,
                    dnaTables: r._data.tables,
                    panelTable: r._data.panelTable,
                    profiles: r._data.profiles,
                    font: r._data.font,
                    techniques: r._data.techniques,
                    banks: r._data.banks,
                    ...(r._data.cursorGlyphs ? { cursorGlyphs: r._data.cursorGlyphs } : {}),
                }, { playSound }, r._seed.step === "list");
                r._clock = new ui.MenuDisplayClock();
            } catch (error) { fail(error); return null; }
        }
        const held = keys ? [...keys] : [];
        try {
            for (const frame of r._clock.advance(dt)) {
                r._session.tick(buttonsForTick(held), frame.tick);
                r._ticks++;
                const pane = r._session.pane;
                if (r._session.step() === "done") {
                    r._answer = pane ? pane.answer() : -2;
                    r._species = pane ? pane.speciesOut() : null;
                    return r._answer;
                }
                if (pane && r._answer === null) {
                    const word = pane.answer();
                    if (word !== -1) {
                        r._answer = word;
                        r._species = pane.speciesOut();
                        return word;
                    }
                }
            }
        } catch (error) {
            fail(error);
        }
        return null;
    };

    r.draw = (ctx, viewW = 320) => {
        if (!r._open || !r._session) return;
        const active = r._session.step() === "pane" ? r._session.pane : r._session.list;
        if (!active) return;
        const s = viewW / 320;
        ctx.save();
        ctx.scale(s, s);
        paintNativeSession(ctx, renderer, active, { fade: false });
        paintMoves(ctx, active);
        ctx.restore();
    };

    /** The vsync blit's VRAM-to-VRAM copies land on top of the finished frame. */
    function paintMoves(ctx, session) {
        const info = r._data?.manifest?.strip;
        if (!info) return;
        const [vx, vy] = info.vram;
        if (!r._strip) {
            const uploaded = wfightLoaderRegion(vx, vy, info.width, info.height);
            r._stripSource = uploaded ? "loader-vram" : "data";
            r._strip = stripCanvas(uploaded ?? r._data.strip, info.width, info.height);
        }
        if (!r._strip) return;
        for (const m of session.moves ?? []) {
            if (m.dstY >= 0x100) continue;
            const sx = m.srcX - vx, sy = m.srcY - vy;
            if (sx < 0 || sy < 0 || sx + m.w > info.width || sy + m.h > info.height) {
                r._lastDiagnostic = `VRAM copy from ${m.srcX},${m.srcY} is outside the marker strip`;
                continue;
            }
            ctx.drawImage(r._strip, sx, sy, m.w, m.h, m.dstX, m.dstY, m.w, m.h);
        }
    }

    r.close = () => {
        if (!r._open) return;
        r._open = false;
        const session = r._session;
        r._session = null;
        if (session && session.step() !== "done") session.dispose();
    };

    r.diagnostics = () => {
        const pane = r._session?.pane ?? null;
        const list = r._session?.list ?? null;
        return {
            execution: "translated",
            open: r._open,
            pending: r.isPending(),
            queued: r._queue.length,
            failed: r._failed,
            error: r._error?.message ?? null,
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
            seed: r._seed,
            stripSource: r._stripSource,
            renderer: renderer.stats,
            lastDiagnostic: r._lastDiagnostic,
        };
    };

    return r;
}